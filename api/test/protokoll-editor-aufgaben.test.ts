import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EditorAufgabe,
  EditorCollection,
  EditorItem,
  EditorReview,
  EditorSperre,
  GetEditorAufgaben,
  GetEditorProtokoll,
} from '../endpoints/intern-protokoll-editor';
import {
  createTask,
  deleteTaskProject,
  getTaskProjects,
  getTasks,
  saveTaskProject,
} from '../lib/aufgaben';
import { CONFIG } from '../lib/config';
import * as leitendeList from '../lib/leitende-list';
import { ValidationError } from '../lib/validation/errors';
import { validateProtokollInhalt } from '../lib/validation/protokoll-inhalt';
import type {
  ProtokollEditorAufgaben,
  ProtokollEditorDetail,
  ProtokollInhalt,
} from '../lib/protokoll-editor-model';
import {
  OFFENE_AUFGABEN_TITEL,
  mergeOffeneAufgaben,
  neuerPunkt,
  offeneAufgabenFuer,
  protokollEintraege,
} from '../lib/protokoll-editor-model';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as taskDirectory from '../lib/task-directory';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.reviewer@stamm-phoenix.de';
const TOKEN_A = 'tab-a-0123456789abcdef';

function request(
  login: string,
  method: string,
  params: Record<string, string> = {},
  body?: unknown
): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated', 'team_leitende'],
  };
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/protokoll-editor',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'protokoll-editor-aufgaben-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'warn', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

/** Directory, Vorstand and SharePoint without Graph. */
function setup(t: TestContext): void {
  overrideConfig(t, CONFIG.protokolle, { sender: '' });
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Autorin', givenName: 'Anna' },
  ]);
  t.mock.method(leitendeList, 'getLeitende', async () => []);
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  let uploads = 0;
  t.mock.method(
    sharePoint,
    'createSharePointDriveFile',
    async (_drive: string, _folder: string, name: string) => ({
      id: `item-${++uploads}`,
      name,
      webUrl: `https://sharepoint.test/${encodeURIComponent(name)}`,
    })
  );
  t.mock.method(sharePoint, 'deleteSharePointDriveItem', async () => undefined);
}

async function create(context: InvocationContext, date = '2026-10-14'): Promise<number> {
  const created = await EditorCollection(
    request(ANNA, 'POST', {}, { title: 'Leitendenrunde', date }),
    context
  );
  assert.equal(created.status, 201);
  return (created.jsonBody as { id: number }).id;
}

async function load(id: number): Promise<ProtokollEditorDetail> {
  const loaded = await GetEditorProtokoll(
    request(BEN, 'GET', { id: String(id) }),
    new InvocationContext({ functionName: 'protokoll-editor-aufgaben-test' })
  );
  assert.equal(loaded.status, 200);
  return loaded.jsonBody as ProtokollEditorDetail;
}

async function save(
  context: InvocationContext,
  id: number,
  change: (inhalt: ProtokollInhalt) => void
): Promise<void> {
  const detail = await load(id);
  const inhalt = structuredClone(detail.inhalt);
  change(inhalt);
  const saved = await EditorItem(
    request(
      ANNA,
      'PUT',
      { id: String(id) },
      { token: TOKEN_A, etag: detail.etag, title: detail.title, date: detail.date, inhalt }
    ),
    context
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  await EditorSperre(request(ANNA, 'DELETE', { id: String(id) }, { token: TOKEN_A }), context);
}

async function approve(context: InvocationContext, id: number) {
  const detail = await load(id);
  const approved = await EditorReview(
    request(BEN, 'POST', { id: String(id) }, { action: 'approve', etag: detail.etag }),
    context
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.jsonBody));
  return approved.jsonBody as { fileName: string; aufgaben: number };
}

async function projectId(title: string, campflowId = ''): Promise<number> {
  await saveTaskProject(title, campflowId, ANNA);
  const project = (await getTaskProjects()).find((p) => p.title === title);
  assert.ok(project);
  return project.id;
}

dbTest('the approval creates the tasks of the minutes in their projects', async (t) => {
  setup(t);
  const context = quietContext(t);
  const lager = await projectId('Pfingstlager', 'evt_pfingsten');
  const weg = await projectId('Altes Projekt');
  const id = await create(context);
  const longTitle = `Zelte ${'prüfen '.repeat(40)}`.trim();
  await save(context, id, (inhalt) => {
    const [stufen, , planung, sonstiges] = inhalt.punkte;
    planung.projekt = { id: lager, titel: 'Pfingstlager' };
    planung.aufgaben = [
      {
        id: 'a-1',
        titel: '  Anzahlung überweisen ',
        zustaendig: [
          { login: ANNA, name: 'Anna Autorin' },
          { login: 'kein-login', name: 'Gast Person' },
        ],
        faellig: '2026-11-01',
      },
      { id: 'a-2', titel: '   ', zustaendig: [], faellig: '' },
    ];
    planung.unterpunkte = [
      {
        ...neuerPunkt('u-1', 'Küche'),
        aufgaben: [{ id: 'a-3', titel: longTitle, zustaendig: [], faellig: '' }],
      },
    ];
    stufen.unterpunkte[0].aufgaben = [
      { id: 'a-4', titel: 'Halstücher bestellen', zustaendig: [], faellig: '' },
    ];
    sonstiges.projekt = { id: weg, titel: 'Altes Projekt' };
    sonstiges.aufgaben = [{ id: 'a-5', titel: 'Ohne Projekt', zustaendig: [], faellig: '' }];
  });
  // Deleted before the approval: the task is created without a project
  const altes = (await getTaskProjects()).find((p) => p.id === weg);
  await deleteTaskProject(weg, altes?.etag, ANNA);

  const result = await approve(context, id);
  assert.equal(result.aufgaben, 4);
  assert.equal((await load(id)).aufgabenAngelegt, 4);

  const tasks = (await getTasks()).filter((task) => task.protokollId === id);
  assert.deepEqual(
    tasks.map((task) => ({
      title: task.title,
      state: task.state,
      projectId: task.projectId,
      dueDate: task.dueDate,
      punkt: task.protokollPunkt,
      people: task.assignees,
    })),
    [
      {
        title: 'Halstücher bestellen',
        state: 'offen',
        projectId: null,
        dueDate: null,
        punkt: '1a. Wölflinge',
        people: [],
      },
      {
        title: 'Anzahlung überweisen',
        state: 'offen',
        projectId: lager,
        dueDate: '2026-11-01',
        punkt: '3. Planung',
        people: [
          { login: ANNA, name: 'Anna Autorin' },
          { login: '', name: 'Gast Person' },
        ],
      },
      {
        title: `${longTitle.slice(0, 199).trimEnd()}…`,
        state: 'offen',
        projectId: lager,
        dueDate: null,
        punkt: '3a. Küche',
        people: [],
      },
      {
        title: 'Ohne Projekt',
        state: 'offen',
        projectId: null,
        dueDate: null,
        punkt: '4. Sonstiges',
        people: [],
      },
    ]
  );
  // The full title of a long task stays in the description
  assert.equal(tasks[2].description, longTitle);
});

dbTest('new minutes start with the open tasks from earlier minutes', async (t) => {
  setup(t);
  const context = quietContext(t);
  const first = await create(context, '2026-09-01');
  await save(context, first, (inhalt) => {
    inhalt.punkte[3].aufgaben = [
      { id: 'a-1', titel: 'Schlüssel abgeben', zustaendig: [], faellig: '2026-10-01' },
      { id: 'a-2', titel: 'Plakat drucken', zustaendig: [], faellig: '' },
    ];
  });
  await approve(context, first);
  // A task created by hand is not from minutes
  await createTask(
    { title: 'Manuelle\nAufgabe', description: '', assignee: '', dueDate: null, projectId: null },
    ANNA
  );

  const next = await load(await create(context, '2026-10-01'));
  const [offene, stufen] = next.inhalt.punkte;
  assert.equal(offene.titel, OFFENE_AUFGABEN_TITEL);
  assert.deepEqual(
    offene.offeneAufgaben.map((a) => [a.titel, a.faellig, a.erledigt]),
    [
      ['Schlüssel abgeben', '2026-10-01', false],
      ['Plakat drucken', '', false],
    ]
  );
  assert.equal(stufen.titel, 'Stufenberichte');

  // Ticked off in the meeting: the task is done at once, if it did not change meanwhile
  const plakat = offene.offeneAufgaben[1];
  const loaded = (await GetEditorAufgaben(request(ANNA, 'GET'), context))
    .jsonBody as ProtokollEditorAufgaben;
  const version = loaded.versionen[plakat.id];
  assert.ok(version);
  const done = await EditorAufgabe(
    request(ANNA, 'PUT', { id: String(plakat.id) }, { erledigt: true, etag: version }),
    context
  );
  assert.equal(done.status, 200);
  const doneVersion = (done.jsonBody as { etag: string }).etag;
  assert.notEqual(doneVersion, version);
  const list = await GetEditorAufgaben(request(ANNA, 'GET'), context);
  const aufgaben = list.jsonBody as ProtokollEditorAufgaben;
  assert.deepEqual(
    aufgaben.offen.map((a) => [a.titel, a.ausProtokoll]),
    [
      ['Schlüssel abgeben', true],
      ['Manuelle Aufgabe', false],
    ]
  );
  // Done tasks keep their version, so they can be opened again
  assert.equal(aufgaben.versionen[plakat.id], doneVersion);
  assert.equal((await getTasks()).find((task) => task.id === plakat.id)?.state, 'erledigt');

  // A late request with the old version does not overwrite the newer state
  const stale = await EditorAufgabe(
    request(ANNA, 'PUT', { id: String(plakat.id) }, { erledigt: false, etag: version }),
    context
  );
  assert.equal(stale.status, 409);
  assert.equal((await getTasks()).find((task) => task.id === plakat.id)?.state, 'erledigt');

  // Opened again
  const reopened = await EditorAufgabe(
    request(ANNA, 'PUT', { id: String(plakat.id) }, { erledigt: false, etag: doneVersion }),
    context
  );
  assert.equal(reopened.status, 200);
  assert.equal((await getTasks()).find((task) => task.id === plakat.id)?.state, 'offen');

  const missing = await EditorAufgabe(
    request(ANNA, 'PUT', { id: '999999' }, { erledigt: true, etag: version }),
    context
  );
  assert.equal(missing.status, 404);
  const invalid = await EditorAufgabe(
    request(ANNA, 'PUT', { id: String(plakat.id) }, { erledigt: 'ja' }),
    context
  );
  assert.equal(invalid.status, 400);
});

dbTest('without open tasks from minutes, new minutes start with the standard agenda', async (t) => {
  setup(t);
  const context = quietContext(t);
  const detail = await load(await create(context));
  assert.equal(detail.inhalt.punkte[0].titel, 'Stufenberichte');
  assert.equal(detail.aufgabenAngelegt, 0);
});

test('minutes stored before step 3 read without project and open tasks', () => {
  const inhalt = validateProtokollInhalt({
    kopf: {
      sitzungsleitung: [],
      protokollant: [],
      beginn: '',
      ende: '',
      teilnehmende: [],
      externe: '',
    },
    punkte: [{ id: 'p-1', titel: 'Alt', text: '', aufgaben: [], termine: [], unterpunkte: [] }],
    naechsteSitzung: { datum: '', uhrzeit: '', ort: '' },
  });
  assert.equal(inhalt.punkte[0].projekt, null);
  assert.deepEqual(inhalt.punkte[0].offeneAufgaben, []);
  assert.throws(
    () =>
      validateProtokollInhalt({
        ...inhalt,
        punkte: [{ ...inhalt.punkte[0], projekt: { id: 'x', titel: 'Kaputt' } }],
      }),
    (error: unknown) =>
      error instanceof ValidationError && /Projekt/.test(error.fields.inhalt ?? '')
  );
});

test('sub-items take the project of their item unless they have their own', () => {
  const punkt = {
    ...neuerPunkt('p-1', 'Lager'),
    projekt: { id: 1, titel: 'Lager' },
    aufgaben: [{ id: 'a-1', titel: 'Eins', zustaendig: [], faellig: '' }],
    unterpunkte: [
      {
        ...neuerPunkt('u-1', 'Küche'),
        aufgaben: [{ id: 'a-2', titel: 'Zwei', zustaendig: [], faellig: '' }],
      },
      {
        ...neuerPunkt('u-2', 'Material'),
        projekt: { id: 2, titel: 'Material' },
        aufgaben: [{ id: 'a-3', titel: 'Drei', zustaendig: [], faellig: '' }],
      },
    ],
  };
  const eintraege = protokollEintraege({
    kopf: {
      sitzungsleitung: [],
      protokollant: [],
      beginn: '',
      ende: '',
      teilnehmende: [],
      externe: '',
    },
    punkte: [punkt],
    naechsteSitzung: { datum: '', uhrzeit: '', ort: '' },
  });
  assert.deepEqual(
    eintraege.map((e) => [e.aufgabe.titel, e.punkt, e.projekt?.id ?? null]),
    [
      ['Eins', '1. Lager', 1],
      ['Zwei', '1a. Küche', 1],
      ['Drei', '1b. Material', 2],
    ]
  );
});

test('reloading the open tasks takes the state of the module Aufgaben', () => {
  const quelle = (id: number, titel: string, faellig = '') => ({
    id,
    titel,
    zustaendig: [],
    faellig,
    projektId: 7,
    ausProtokoll: false,
  });
  const offen = offeneAufgabenFuer(
    [quelle(1, 'B', '2026-12-01'), quelle(2, 'A'), quelle(3, 'C', '2026-11-01')],
    7
  );
  assert.deepEqual(
    offen.map((a) => a.id),
    [3, 1, 2]
  );
  const aufgabe = (id: number, titel: string, erledigt: boolean) => ({
    id,
    titel,
    zustaendig: [],
    faellig: '',
    erledigt,
  });
  const merged = mergeOffeneAufgaben(
    [
      // Ticked in the meeting, so done in the module
      aufgabe(3, 'C', true),
      aufgabe(1, 'B alt', false),
      // Deleted in the module
      aufgabe(9, 'Weg', false),
      // Done elsewhere meanwhile
      aufgabe(5, 'Anderswo erledigt', false),
      // Done before, opened again elsewhere
      aufgabe(6, 'Wieder offen', true),
    ],
    [quelle(1, 'B neu'), quelle(6, 'Wieder offen'), quelle(4, 'Neu')],
    new Set([3, 5])
  );
  assert.deepEqual(
    merged.map((a) => [a.id, a.titel, a.erledigt]),
    [
      [3, 'C', true],
      [1, 'B neu', false],
      [5, 'Anderswo erledigt', true],
      [6, 'Wieder offen', false],
      [4, 'Neu', false],
    ]
  );
});
