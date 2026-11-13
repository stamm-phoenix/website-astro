/** The Protokoll-Editor: documents, versions, review, sending and its tasks. */
import { ValidationError } from '../../api/lib/validation/errors';
import { taskPeople } from '../../api/lib/aufgaben-zuordnung';
import type {
  OffeneAufgabeQuelle,
  ProtokollEditorAufgaben,
} from '../../api/lib/protokoll-editor-model';
import { einzeilig } from '../../api/lib/protokoll-editor-inhalt';
import { MOCK_LEITENDE, mockPersonen } from './mock-data/personen';
import { minimalPdf } from './mock-data/content';
import {
  createEditorProtokoll,
  deleteEditorProtokoll,
  editorDetail,
  editorLive,
  editorOverview,
  editorRevision,
  editorPdfName,
  editorRevisions,
  releaseEditorSperre,
  reviewEditorProtokoll,
  saveEditorProtokoll,
  takeEditorSperre,
  versandEditorProtokoll,
} from './mock-data/protokollEditor';
import type { ReviewResult } from './mock-data/protokollEditor';
import { newEtag, newId } from './mock-data/util';
import { error, json, noContent, notFound, route, str, strings } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { TASK_CONFLICT, taskData } from './mockAufgaben';

// --- Protokoll-Editor ---

const EDITOR_LOCKED = (sperre: { name: string }): MockResult =>
  json(
    {
      error: 'LOCKED',
      code: 'LOCKED',
      message: `Das Protokoll wird gerade von ${sperre.name} geschrieben.`,
      sperre,
    },
    423
  );

/** The token of the editor tab, sent in a header by reads. */
function tabToken(req: MockRequest): string | null {
  const value = req.headers['x-protokoll-tab'];
  return typeof value === 'string' && value ? value : null;
}

route('GET', '/api/intern/protokoll-editor', () => json(editorOverview()));

route('GET', '/api/intern/protokoll-editor-personen', () =>
  json({
    personen: [
      ...MOCK_LEITENDE.map((person) => ({ ...person, gruppe: 'leitende' })),
      ...mockPersonen()
        .filter((person) => person.aktiv && person.gruppe !== 'leitende')
        .sort((a, b) => (a.gruppe === b.gruppe ? 0 : a.gruppe === 'altleitende' ? -1 : 1))
        .map(({ name, login, gruppe }) => ({ name, login, gruppe })),
    ],
    unavailable: false,
  })
);

/** Projects and open tasks of the mock module Aufgaben, as `getProtokollEditorAufgaben`. */
function editorAufgaben(): ProtokollEditorAufgaben {
  return {
    projekte: [...taskData.projects]
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .map((project) => ({
        id: project.id,
        titel: einzeilig(project.title),
        campflowId: project.campflowId,
      })),
    offen: taskData.tasks
      .filter((task) => task.state === 'offen')
      .map((task): OffeneAufgabeQuelle => ({
        id: task.id,
        titel: einzeilig(task.title),
        zustaendig: taskPeople(task).map(({ login, name }) => ({
          login: einzeilig(login, 254),
          name: einzeilig(name),
        })),
        faellig: task.dueDate ?? '',
        projektId: task.projectId,
        ausProtokoll: Boolean(task.protokollId) || task.sourceId !== '',
      })),
    versionen: Object.fromEntries(
      taskData.tasks
        .filter((task) => task.state === 'offen' || task.state === 'erledigt')
        .map((task) => [task.id, task.etag])
    ),
  };
}

route('GET', '/api/intern/protokoll-editor-aufgaben', () => json(editorAufgaben()));

route('PUT', '/api/intern/pflege/protokoll-editor-aufgaben/:id', (req) => {
  const task = taskData.tasks.find((t) => t.id === Number(req.params.id));
  if (!task || (task.state !== 'offen' && task.state !== 'erledigt')) return notFound();
  if (typeof req.json?.erledigt !== 'boolean') {
    throw new ValidationError({ erledigt: 'Bitte angeben, ob die Aufgabe erledigt ist.' });
  }
  if (req.json.etag !== task.etag) return TASK_CONFLICT();
  task.state = req.json.erledigt ? 'erledigt' : 'offen';
  task.etag = newEtag(newId());
  return json({ etag: task.etag });
});

route('GET', '/api/intern/protokoll-editor/:id', (req) => {
  const detail = editorDetail(req.params.id, tabToken(req));
  return detail ? json(detail) : notFound();
});

route(
  'GET',
  '/api/intern/protokoll-editor/:id/live',
  (req) => {
    const live = editorLive(req.params.id, req.query.get('etag') ?? '', tabToken(req));
    return live ? json(live) : notFound();
  },
  true
);

route('GET', '/api/intern/protokoll-editor/:id/versionen', (req) => {
  const list = editorRevisions(req.params.id);
  return list ? json(list) : notFound();
});

route('GET', '/api/intern/protokoll-editor/:id/versionen/:revisionId', (req) => {
  const revision = editorRevision(req.params.id, req.params.revisionId);
  return revision ? json(revision) : notFound();
});

route('POST', '/api/intern/pflege/protokoll-editor', (req) => {
  const body = req.json ?? {};
  const title = str(body.title).trim();
  const date = str(body.date);
  const beginn = str(body.beginn);
  const fields: Record<string, string> = {};
  if (!title) fields.title = 'Bitte einen Titel angeben.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Bitte das Datum der Sitzung angeben.';
  if (beginn && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(beginn)) {
    fields.beginn = 'Bitte eine Uhrzeit wie 19:30 angeben.';
  }
  if (Object.keys(fields).length > 0) {
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
  }
  return json({ id: createEditorProtokoll(title, date, beginn, editorAufgaben().offen) }, 201);
});

route(['PUT', 'DELETE'], '/api/intern/pflege/protokoll-editor/:id', (req) => {
  if (req.method === 'DELETE') {
    return deleteEditorProtokoll(req.params.id) ? noContent() : notFound();
  }
  const body = req.json ?? {};
  const result = saveEditorProtokoll(req.params.id, {
    token: str(body.token),
    etag: str(body.etag),
    title: str(body.title),
    date: str(body.date),
    inhalt: body.inhalt as Parameters<typeof saveEditorProtokoll>[1]['inhalt'],
    aktiverPunkt: typeof body.aktiverPunkt === 'string' ? body.aktiverPunkt : null,
    sicherung:
      body.sicherung === 'ueberschreiben' || body.sicherung === 'wiederherstellen'
        ? body.sicherung
        : null,
  });
  if (!result) return notFound();
  if ('locked' in result) return EDITOR_LOCKED(result.locked);
  if ('notEditable' in result) return EDITOR_NOT_EDITABLE();
  if ('conflict' in result) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  return json(result.ok);
});

route(['POST', 'DELETE'], '/api/intern/pflege/protokoll-editor/:id/sperre', (req) => {
  const body = req.json ?? {};
  const token = str(body.token);
  if (req.method === 'DELETE') {
    releaseEditorSperre(req.params.id, token);
    return noContent();
  }
  const result = takeEditorSperre(
    req.params.id,
    token,
    body.uebernehmen === true,
    typeof body.aktiverPunkt === 'string' ? body.aktiverPunkt : null
  );
  if (!result) return notFound();
  if ('notEditable' in result) return EDITOR_NOT_EDITABLE();
  return 'locked' in result ? EDITOR_LOCKED(result.locked) : json(result.ok);
});

const EDITOR_NOT_EDITABLE = (): MockResult =>
  error(
    409,
    'NOT_EDITABLE',
    'Das Protokoll ist nicht mehr im Entwurf und kann nicht mehr bearbeitet werden.'
  );

function reviewResponse(result: ReviewResult): MockResult {
  if (!result) return notFound();
  if ('locked' in result) return EDITOR_LOCKED(result.locked);
  if ('conflict' in result) {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  if ('invalid' in result) {
    return error(
      400,
      'INVALID',
      result.invalid,
      result.field ? { [result.field]: result.invalid } : { form: result.invalid }
    );
  }
  return json(result.ok);
}

route('POST', '/api/intern/pflege/protokoll-editor/:id/review', (req) => {
  const body = req.json ?? {};
  return reviewResponse(
    reviewEditorProtokoll(req.params.id, {
      action: str(body.action),
      etag: str(body.etag),
      token: typeof body.token === 'string' ? body.token : null,
      note: str(body.note),
      ownConfirmed: body.ownConfirmed === true,
    })
  );
});

route('POST', '/api/intern/pflege/protokoll-editor/:id/versand', (req) => {
  const body = req.json ?? {};
  return reviewResponse(
    versandEditorProtokoll(req.params.id, {
      action: str(body.action),
      etag: str(body.etag),
      version: str(body.version),
      retry: body.retry === true,
      excluded: strings(body.excluded),
      extra: strings(body.extra),
    })
  );
});

route(
  'GET',
  '/api/intern/protokoll-editor/:id/pdf',
  (req) => {
    const fileName = editorPdfName(req.params.id);
    if (!fileName) return notFound();
    return {
      kind: 'raw',
      status: 200,
      contentType: 'application/pdf',
      body: minimalPdf(fileName),
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    };
  },
  true
);
