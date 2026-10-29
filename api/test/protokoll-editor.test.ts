import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EditorCollection,
  EditorItem,
  EditorSperre,
  GetEditorLive,
  GetEditorPersonen,
  GetEditorProtokoll,
  GetEditorRevision,
  GetEditorRevisions,
} from '../endpoints/intern-protokoll-editor';
import { seedPreviewProtokollEditor } from '../lib/db-preview';
import * as leitendeList from '../lib/leitende-list';
import { ValidationError } from '../lib/validation/errors';
import { validateProtokollEditorCreate } from '../lib/validation/protokoll-editor';
import { validateProtokollInhalt } from '../lib/validation/protokoll-inhalt';
import { getEditorOverview, saveEditorProtokoll, takeSperre } from '../lib/protokoll-editor';
import type {
  ProtokollEditorDetail,
  ProtokollInhalt,
  ProtokollLiveResponse,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollSaveResponse,
} from '../lib/protokoll-editor-model';
import type { ProtokollEditorPersonen } from '../lib/protokoll-editor-model';
import type { Person, PersonenUebersicht } from '../lib/personen-model';
import {
  SPERRE_SECONDS,
  aktionZeitraum,
  neuerInhalt,
  upgradeInhalt,
} from '../lib/protokoll-editor-model';
import { PersonItem, PersonenCollection } from '../endpoints/intern-pflege-personen';
import * as taskDirectory from '../lib/task-directory';
import { CONFIG } from '../lib/config';
import { getDb, toVersion } from '../lib/db';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.beobachter@stamm-phoenix.de';
const TOKEN_A = 'tab-a-0123456789abcdef';
const TOKEN_B = 'tab-b-0123456789abcdef';

function principal(login: string) {
  return {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated', 'team_leitende'],
  };
}

function request(
  login: string,
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  query = '',
  tab?: string
): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/protokoll-editor${query}`,
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal(login))).toString('base64'),
      ...(tab ? { 'x-protokoll-tab': tab } : {}),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'protokoll-editor-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

/** Directory and Leitende list without SharePoint and Graph. */
function mockDirectory(t: TestContext): void {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Autorin', givenName: 'Anna' },
    { login: BEN, name: 'Ben Beobachter', givenName: 'Ben' },
  ]);
  t.mock.method(leitendeList, 'getLeitende', async () => [
    { id: '1', name: 'Vera Vorstand', teams: ['Vorstand'], hasImage: false },
    { id: '2', name: 'Lea Leiterin', teams: ['Wölflinge'], hasImage: false },
  ]);
}

async function create(t: TestContext): Promise<ProtokollEditorDetail> {
  const context = quietContext(t);
  const created = await EditorCollection(
    request(ANNA, 'POST', {}, { title: 'Leitendenrunde', date: '2026-10-14' }),
    context
  );
  assert.equal(created.status, 201);
  const { id } = created.jsonBody as { id: number };
  const loaded = await GetEditorProtokoll(request(ANNA, 'GET', { id: String(id) }), context);
  return loaded.jsonBody as ProtokollEditorDetail;
}

function withText(inhalt: ProtokollInhalt, text: string): ProtokollInhalt {
  const [first, ...rest] = inhalt.punkte;
  return { ...inhalt, punkte: [{ ...first, text }, ...rest] };
}

function save(
  detail: ProtokollEditorDetail,
  etag: string,
  token: string,
  inhalt: ProtokollInhalt,
  extra: Record<string, unknown> = {}
) {
  return {
    token,
    etag,
    title: detail.title,
    date: detail.date,
    inhalt,
    aktiverPunkt: inhalt.punkte[0].id,
    ...extra,
  };
}

dbTest('new minutes get the standard agenda, the Vorstand and the writer', async (t) => {
  mockDirectory(t);
  const detail = await create(t);
  assert.equal(detail.status, 'entwurf');
  // Vera is not in the directory, so she has no login; the writer has one
  assert.deepEqual(detail.inhalt.kopf.sitzungsleitung, [{ login: '', name: 'Vera Vorstand' }]);
  assert.deepEqual(detail.inhalt.kopf.protokollant, [{ login: ANNA, name: 'Anna Autorin' }]);
  assert.deepEqual(detail.inhalt.punkte[0].termine, []);
  assert.deepEqual(
    detail.inhalt.punkte.map((p) => [p.titel, p.unterpunkte.map((u) => u.titel)]),
    [
      ['Stufenberichte', ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'StaVos']],
      ['Reflexion', []],
      ['Planung', []],
      ['Sonstiges', []],
    ]
  );
  assert.equal(detail.inhalt.kopf.beginn, '');
  assert.equal(detail.sperre, null);
  assert.equal(detail.canDelete, true);
});

dbTest('new minutes take the start of the meeting from the browser', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const created = await EditorCollection(
    request(ANNA, 'POST', {}, { title: 'Leitendenrunde', date: '2026-10-14', beginn: '19:30' }),
    context
  );
  assert.equal(created.status, 201);
  const { id } = created.jsonBody as { id: number };
  const loaded = await GetEditorProtokoll(request(ANNA, 'GET', { id: String(id) }), context);
  assert.equal((loaded.jsonBody as ProtokollEditorDetail).inhalt.kopf.beginn, '19:30');
});

dbTest('the writing tab saves; another tab must ask before taking over', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };

  const first = await EditorItem(
    request(
      ANNA,
      'PUT',
      params,
      save(detail, detail.etag, TOKEN_A, withText(detail.inhalt, 'Eins'))
    ),
    context
  );
  assert.equal(first.status, 200);
  const saved = first.jsonBody as ProtokollSaveResponse;
  assert.equal(saved.sperre.mine, true);
  assert.equal(saved.sperre.name, 'Anna Autorin');

  // Ben opens the minutes: Anna writes, he may not save
  const blocked = await EditorItem(
    request(BEN, 'PUT', params, save(detail, saved.etag, TOKEN_B, withText(detail.inhalt, 'Ben'))),
    context
  );
  assert.equal(blocked.status, 423);
  assert.equal((blocked.jsonBody as { sperre: { name: string } }).sperre.name, 'Anna Autorin');

  const ask = await EditorSperre(request(BEN, 'POST', params, { token: TOKEN_B }), context);
  assert.equal(ask.status, 423);

  const takeover = await EditorSperre(
    request(BEN, 'POST', params, { token: TOKEN_B, uebernehmen: true }),
    context
  );
  assert.equal(takeover.status, 200);
  assert.equal((takeover.jsonBody as ProtokollSaveResponse).sperre.name, 'Ben Beobachter');

  // Anna's next save is refused instead of overwriting Ben
  const late = await EditorItem(
    request(
      ANNA,
      'PUT',
      params,
      save(detail, saved.etag, TOKEN_A, withText(detail.inhalt, 'Zwei'))
    ),
    context
  );
  assert.equal(late.status, 423);

  const revisions = await GetEditorRevisions(request(BEN, 'GET', params), context);
  assert.deepEqual(
    (revisions.jsonBody as ProtokollRevisionListItem[]).map((r) => r.reason),
    ['uebernahme', 'speichern']
  );
});

dbTest('a save against an old version is refused', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const ok = await EditorItem(
    request(ANNA, 'PUT', params, save(detail, detail.etag, TOKEN_A, withText(detail.inhalt, 'A'))),
    context
  );
  assert.equal(ok.status, 200);
  const stale = await EditorItem(
    request(ANNA, 'PUT', params, save(detail, detail.etag, TOKEN_A, withText(detail.inhalt, 'B'))),
    context
  );
  assert.equal(stale.status, 409);
});

dbTest('an outdated save leaves the lock of another tab and the revisions alone', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const first = await EditorItem(
    request(ANNA, 'PUT', params, save(detail, detail.etag, TOKEN_A, withText(detail.inhalt, 'A'))),
    context
  );
  assert.equal(first.status, 200);
  const before = (await GetEditorRevisions(request(BEN, 'GET', params), context))
    .jsonBody as ProtokollRevisionListItem[];

  // Ben's version is outdated and Anna writes: the conflict wins, nothing is written
  const stale = await EditorItem(
    request(BEN, 'PUT', params, save(detail, detail.etag, TOKEN_B, withText(detail.inhalt, 'B'))),
    context
  );
  assert.equal(stale.status, 409);
  const after = (await GetEditorRevisions(request(BEN, 'GET', params), context))
    .jsonBody as ProtokollRevisionListItem[];
  assert.deepEqual(after, before);
  const loaded = (
    await GetEditorProtokoll(request(ANNA, 'GET', params, undefined, '', TOKEN_A), context)
  ).jsonBody as ProtokollEditorDetail;
  assert.equal(loaded.sperre?.mine, true);
});

dbTest('reads know the tab from its header, not from the URL', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const taken = await EditorSperre(request(ANNA, 'POST', params, { token: TOKEN_A }), context);
  assert.equal(taken.status, 200);
  const byHeader = (
    await GetEditorProtokoll(request(ANNA, 'GET', params, undefined, '', TOKEN_A), context)
  ).jsonBody as ProtokollEditorDetail;
  assert.equal(byHeader.sperre?.mine, true);
  const byQuery = (
    await GetEditorProtokoll(request(ANNA, 'GET', params, undefined, `?token=${TOKEN_A}`), context)
  ).jsonBody as ProtokollEditorDetail;
  assert.equal(byQuery.sperre?.mine, false);
});

dbTest('new minutes need a title that is more than blanks', async (t) => {
  mockDirectory(t);
  const created = await EditorCollection(
    request(ANNA, 'POST', {}, { title: '   ', date: '2026-10-14' }),
    quietContext(t)
  );
  assert.equal(created.status, 400);
  assert.ok((created.jsonBody as { fields: Record<string, string> }).fields.title);
  assert.equal((await getEditorOverview()).protokolle.length, 0);
});

dbTest('an expired lock is free for everyone', async (t) => {
  mockDirectory(t);
  const detail = await create(t);
  const anna = { login: ANNA, name: 'Anna Autorin' };
  const ben = { login: BEN, name: 'Ben Beobachter' };
  const start = new Date('2026-10-14T17:00:00Z');
  await takeSperre(
    detail.id,
    { token: TOKEN_A, uebernehmen: false, aktiverPunkt: null },
    anna,
    start
  );
  await assert.rejects(
    takeSperre(detail.id, { token: TOKEN_B, uebernehmen: false, aktiverPunkt: null }, ben, start),
    { name: 'SperreError' }
  );
  const later = new Date(start.getTime() + (SPERRE_SECONDS + 1) * 1000);
  const taken = await takeSperre(
    detail.id,
    { token: TOKEN_B, uebernehmen: false, aktiverPunkt: null },
    ben,
    later
  );
  assert.equal(taken.sperre.name, 'Ben Beobachter');
  assert.equal((await getEditorOverview(later)).protokolle[0].writer, 'Ben Beobachter');
});

dbTest('readers get the minutes only when they changed', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const unchanged = await GetEditorLive(
    request(BEN, 'GET', params, undefined, `?etag=${encodeURIComponent(detail.etag)}`),
    context
  );
  const quiet = unchanged.jsonBody as ProtokollLiveResponse;
  assert.equal(quiet.protokoll, null);
  assert.equal(quiet.etag, detail.etag);

  const saved = await EditorItem(
    request(
      ANNA,
      'PUT',
      params,
      save(detail, detail.etag, TOKEN_A, withText(detail.inhalt, 'Neu'))
    ),
    context
  );
  assert.equal(saved.status, 200);
  const changed = await GetEditorLive(
    request(BEN, 'GET', params, undefined, `?etag=${encodeURIComponent(detail.etag)}`),
    context
  );
  const live = changed.jsonBody as ProtokollLiveResponse;
  assert.equal(live.protokoll?.inhalt.punkte[0].text, 'Neu');
  assert.equal(live.sperre?.name, 'Anna Autorin');
  assert.equal(live.sperre?.mine, false);
  assert.equal(live.sperre?.aktiverPunkt, detail.inhalt.punkte[0].id);
});

dbTest('the minutes, their lock and their tasks are read in one statement', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const inhalt = withText(detail.inhalt, 'Beschlossen');
  const saved = await EditorItem(
    request(ANNA, 'PUT', params, save(detail, detail.etag, TOKEN_A, inhalt)),
    context
  );
  assert.equal(saved.status, 200);
  const db = getDb();
  const at = new Date('2026-10-15T18:30:00.000Z');
  await db
    .updateTable('protokoll.protokoll')
    .set({
      status: 'freigegeben',
      submitted_by: ANNA,
      submitted_at: at,
      review_note: 'Passt.',
      approved_by: BEN,
      approved_at: at,
      pdf_drive_id: 'drive',
      pdf_item_id: 'item',
      pdf_name: 'Protokoll.pdf',
      pdf_url: 'https://example.test/Protokoll.pdf',
      delivery_state: 'sent',
      delivery_recipients: 12,
      delivery_at: at,
      delivery_by: BEN,
    })
    .where('id', '=', detail.id)
    .execute();
  const task = (aufgabe: string) => ({
    title: `Aufgabe ${aufgabe}`,
    description: '',
    assignee: '',
    due_date: null,
    project_id: null,
    state: 'offen' as const,
    protokoll_id: detail.id,
    protokoll_aufgabe: aufgabe,
    updated_by: 'test',
  });
  await db
    .insertInto('organisation.task')
    .values([task('a1'), task('a2')])
    .execute();
  const row = await db
    .selectFrom('protokoll.protokoll')
    .selectAll()
    .where('id', '=', detail.id)
    .executeTakeFirstOrThrow();
  const lock = await db
    .selectFrom('protokoll.sperre')
    .selectAll()
    .where('protokoll_id', '=', detail.id)
    .executeTakeFirstOrThrow();
  const etag = toVersion(row.version);
  const expected = (mine: boolean): ProtokollEditorDetail => ({
    id: detail.id,
    title: 'Leitendenrunde',
    date: '2026-10-14',
    status: 'freigegeben',
    inhalt,
    etag,
    createdAt: detail.createdAt,
    createdBy: ANNA,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: ANNA,
    sperre: {
      login: ANNA,
      name: 'Anna Autorin',
      since: lock.since.toISOString(),
      until: lock.until.toISOString(),
      aktiverPunkt: inhalt.punkte[0].id,
      mine,
      expired: false,
    },
    canDelete: false,
    submittedBy: ANNA,
    submittedAt: at.toISOString(),
    reviewNote: 'Passt.',
    approvedBy: BEN,
    approvedAt: at.toISOString(),
    ablage: { fileName: 'Protokoll.pdf', webUrl: 'https://example.test/Protokoll.pdf' },
    versand: { state: 'sent', recipients: 12, at: at.toISOString(), by: BEN },
    sendingConfigured: CONFIG.protokolle.sender !== '',
    aufgabenAngelegt: 2,
  });

  const queries = recordQueries(t);
  const read = await GetEditorProtokoll(
    request(ANNA, 'GET', params, undefined, '', TOKEN_A),
    context
  );
  assert.deepEqual(read.jsonBody, expected(true));
  assert.equal(queries.roundTrips, 1);

  queries.reset();
  const quiet = await GetEditorLive(
    request(BEN, 'GET', params, undefined, `?etag=${encodeURIComponent(etag)}`),
    context
  );
  assert.deepEqual(quiet.jsonBody, { etag, sperre: expected(false).sperre, protokoll: null });
  // The poll of an unchanged version is a single small statement
  assert.equal(queries.statements.length, 1);
  assert.doesNotMatch(queries.statements[0] ?? '', /content/);

  queries.reset();
  const changed = await GetEditorLive(
    request(BEN, 'GET', params, undefined, `?etag=${encodeURIComponent(detail.etag)}`),
    context
  );
  assert.deepEqual(changed.jsonBody, {
    etag,
    sperre: expected(false).sperre,
    protokoll: expected(false),
  });
  assert.equal(queries.roundTrips, 2);

  // Tasks only count once the minutes are approved
  await db
    .updateTable('protokoll.protokoll')
    .set({ status: 'review' })
    .where('id', '=', detail.id)
    .execute();
  const review = (await GetEditorProtokoll(request(BEN, 'GET', params), context))
    .jsonBody as ProtokollEditorDetail;
  assert.equal(review.status, 'review');
  assert.equal(review.aufgabenAngelegt, 0);
  assert.equal(review.sperre?.mine, false);

  await db.deleteFrom('protokoll.sperre').execute();
  const free = await GetEditorLive(
    request(BEN, 'GET', params, undefined, `?etag=${encodeURIComponent(review.etag)}`),
    context
  );
  assert.deepEqual(free.jsonBody, { etag: review.etag, sperre: null, protokoll: null });
  assert.equal(
    (
      (await GetEditorProtokoll(request(BEN, 'GET', params), context)).jsonBody as
        ProtokollEditorDetail | undefined
    )?.sperre,
    null
  );
  assert.equal(
    (await GetEditorProtokoll(request(BEN, 'GET', { id: String(detail.id + 1) }), context)).status,
    404
  );
  assert.equal(
    (
      await GetEditorLive(
        request(BEN, 'GET', { id: String(detail.id + 1) }, undefined, `?etag=${etag}`),
        context
      )
    ).status,
    404
  );
});

dbTest(
  'revisions are kept every few minutes and before a local version replaces one',
  async (t) => {
    mockDirectory(t);
    const context = quietContext(t);
    const detail = await create(t);
    const anna = { login: ANNA, name: 'Anna Autorin' };
    const start = new Date('2026-10-14T17:00:00Z');
    const base = { token: TOKEN_A, uebernehmen: false, aktiverPunkt: null, sicherung: null };
    const input = (etag: string, text: string, extra = {}) => ({
      ...base,
      etag,
      title: detail.title,
      date: detail.date,
      inhalt: withText(detail.inhalt, text),
      ...extra,
    });

    let { etag } = await saveEditorProtokoll(detail.id, input(detail.etag, 'eins'), anna, start);
    ({ etag } = await saveEditorProtokoll(
      detail.id,
      input(etag, 'zwei'),
      anna,
      new Date(start.getTime() + 60_000)
    ));
    ({ etag } = await saveEditorProtokoll(
      detail.id,
      input(etag, 'drei'),
      anna,
      new Date(start.getTime() + 6 * 60_000)
    ));
    await saveEditorProtokoll(
      detail.id,
      input(etag, 'lokal', { sicherung: 'ueberschreiben' }),
      anna,
      new Date(start.getTime() + 7 * 60_000)
    );

    const params = { id: String(detail.id) };
    const list = (await GetEditorRevisions(request(ANNA, 'GET', params), context))
      .jsonBody as ProtokollRevisionListItem[];
    assert.deepEqual(
      list.map((r) => r.reason),
      ['ueberschreiben', 'speichern', 'speichern']
    );
    const kept = await Promise.all(
      list.map(
        async (r) =>
          (
            (
              await GetEditorRevision(
                request(ANNA, 'GET', { ...params, revisionId: String(r.id) }),
                context
              )
            ).jsonBody as ProtokollRevision
          ).inhalt.punkte[0].text
      )
    );
    assert.deepEqual(kept, ['drei', 'drei', 'eins']);
  }
);

dbTest('any leader deletes a draft', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const deleted = await EditorItem(request(BEN, 'DELETE', params), context);
  assert.equal(deleted.status, 204);
  const gone = await GetEditorProtokoll(request(ANNA, 'GET', params), context);
  assert.equal(gone.status, 404);
});

dbTest('the preview gets invented minutes once', async () => {
  await seedPreviewProtokollEditor(new Date('2026-10-14T12:00:00Z'));
  await seedPreviewProtokollEditor(new Date('2026-10-14T12:00:00Z'));
  const overview = await getEditorOverview();
  assert.deepEqual(overview.protokolle.map((p) => p.status).sort(), ['entwurf', 'review']);
});

test('new minutes take an optional start time', () => {
  const base = { title: 'Leitendenrunde', date: '2026-10-14' };
  assert.equal(validateProtokollEditorCreate(base).beginn, '');
  assert.equal(validateProtokollEditorCreate({ ...base, beginn: '07:05' }).beginn, '07:05');
  assert.throws(() => validateProtokollEditorCreate({ ...base, beginn: '25:00' }), ValidationError);
});

test('the content is checked field by field and kept as typed', () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id-${n++}`);
  inhalt.punkte[1].text = '  Zeile 1\n- Punkt  ';
  assert.deepEqual(validateProtokollInhalt(inhalt), inhalt);

  const duplicate = structuredClone(inhalt);
  duplicate.punkte[2].id = duplicate.punkte[1].id;
  assert.throws(() => validateProtokollInhalt(duplicate), ValidationError);

  const nested = structuredClone(inhalt);
  nested.punkte[0].unterpunkte[0].unterpunkte = [nested.punkte[3]];
  assert.throws(() => validateProtokollInhalt(nested), ValidationError);

  const html = structuredClone(inhalt);
  html.punkte[0].titel = 'Zeile\nzwei';
  assert.throws(() => validateProtokollInhalt(html), ValidationError);

  const extra = { ...structuredClone(inhalt), fremd: 'weg' };
  assert.equal('fremd' in validateProtokollInhalt(extra), false);
});

test('minutes stored before Termine and the person picker still load', () => {
  let n = 0;
  const current = neuerInhalt(() => `id-${n++}`);
  // The shape of #277: names as strings, no `termine`
  const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown> & {
    kopf: Record<string, unknown>;
    punkte: Record<string, unknown>[];
  };
  legacy.kopf.sitzungsleitung = 'Vera Vorstand, Volker Vorstand';
  legacy.kopf.protokollant = '';
  for (const punkt of legacy.punkte) {
    delete punkt.termine;
    for (const sub of punkt.unterpunkte as Record<string, unknown>[]) delete sub.termine;
  }
  const expected = {
    ...current,
    kopf: {
      ...current.kopf,
      sitzungsleitung: [{ login: '', name: 'Vera Vorstand, Volker Vorstand' }],
      protokollant: [],
    },
  };
  assert.deepEqual(validateProtokollInhalt(legacy), expected);
  // The browser upgrades local copies the same way
  assert.deepEqual(upgradeInhalt(legacy as unknown as ProtokollInhalt), expected);
});

test('Termine are checked like Aufgaben', () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id-${n++}`);
  const termin = {
    id: 'termin-1',
    titel: 'Vortreffen',
    datum: '2026-11-02',
    uhrzeit: '18:00',
    ort: 'Stammesheim',
    zustaendig: [{ login: ANNA, name: 'Anna Autorin' }],
  };
  inhalt.punkte[2].termine = [termin];
  inhalt.punkte[0].unterpunkte[1].termine = [{ ...termin, id: 'termin-2', datum: '', uhrzeit: '' }];
  assert.deepEqual(validateProtokollInhalt(inhalt), inhalt);

  for (const broken of [
    { ...termin, datum: '2.11.2026' },
    { ...termin, uhrzeit: '25:00' },
    { ...termin, ort: 'a\nb' },
    { ...termin, id: inhalt.punkte[1].id },
    { ...termin, zustaendig: 'Anna' },
  ]) {
    const copy = structuredClone(inhalt);
    copy.punkte[2].termine = [broken as typeof termin];
    assert.throws(() => validateProtokollInhalt(copy), ValidationError, JSON.stringify(broken));
  }
  const many = structuredClone(inhalt);
  many.punkte[2].termine = Array.from({ length: 21 }, (_, i) => ({ ...termin, id: `t-${i}` }));
  assert.throws(() => validateProtokollInhalt(many), ValidationError);
});

test('the head takes people, at most one writing the minutes', () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id-${n++}`);
  inhalt.kopf.protokollant = [
    { login: ANNA, name: 'Anna Autorin' },
    { login: BEN, name: 'Ben Beobachter' },
  ];
  assert.throws(() => validateProtokollInhalt(inhalt), ValidationError);
});

test('the dates of an Aktion are written compactly', () => {
  const aktion = { id: 'evt_1', titel: 'Lager', start: '2026-06-12', ende: '2026-06-14' };
  assert.equal(aktionZeitraum(aktion), '12.–14.06.2026');
  assert.equal(aktionZeitraum({ ...aktion, ende: '2026-07-02' }), '12.06.–02.07.2026');
  assert.equal(aktionZeitraum({ ...aktion, ende: '' }), '12.06.2026');
  assert.equal(aktionZeitraum({ ...aktion, start: '', ende: '' }), '');
});

dbTest('Altleitende of the list are offered next to the leaders', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const add = async (body: Record<string, unknown>): Promise<number> => {
    const created = await PersonenCollection(request(ANNA, 'POST', {}, body), context);
    assert.equal(created.status, 201, JSON.stringify(created.jsonBody));
    return (created.jsonBody as { id: number }).id;
  };
  await add({ name: 'Anna Altleiterin', login: '', gruppe: 'altleitende', aktiv: true });
  await add({ name: 'Ingo Inaktiv', login: '', gruppe: 'weitere', aktiv: false });
  // Also in the Entra group: stays a leader
  await add({ name: 'Ben B.', login: BEN.toUpperCase(), gruppe: 'weitere', aktiv: true });
  // A leader who left the Entra group: the row only links CampFlow, it is not offered
  await add({
    name: 'Clara Ehemals',
    login: 'clara.ehemals@stamm-phoenix.de',
    gruppe: 'leitende',
    aktiv: true,
  });

  const invalid = await PersonenCollection(
    request(ANNA, 'POST', {}, { name: '', login: 'kein-login', gruppe: 'vorstand', aktiv: 1 }),
    context
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys((invalid.jsonBody as { fields: object }).fields).sort(), [
    'aktiv',
    'gruppe',
    'login',
    'name',
  ]);

  const response = await GetEditorPersonen(request(BEN, 'GET'), context);
  const { personen, unavailable } = response.jsonBody as ProtokollEditorPersonen;
  assert.equal(unavailable, false);
  assert.deepEqual(personen, [
    { login: ANNA, name: 'Anna Autorin', gruppe: 'leitende' },
    { login: BEN, name: 'Ben Beobachter', gruppe: 'leitende' },
    { login: '', name: 'Anna Altleiterin', gruppe: 'altleitende' },
  ]);
});

dbTest('the list of further people is edited with versions', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const created = await PersonenCollection(
    request(
      ANNA,
      'POST',
      {},
      { name: 'Otto Ehemalig', login: '', gruppe: 'altleitende', aktiv: true }
    ),
    context
  );
  const id = String((created.jsonBody as { id: number }).id);
  // Other tests of this file add people too
  const find = async (): Promise<Person | undefined> =>
    (
      (await PersonenCollection(request(ANNA, 'GET'), context)).jsonBody as PersonenUebersicht
    ).personen.find((person) => String(person.id) === id);
  const otto = (await find())!;
  assert.equal(otto.updatedBy, ANNA);

  const changed = await PersonItem(
    request(ANNA, 'PATCH', { id }, { ...otto, aktiv: false, etag: otto.etag }),
    context
  );
  assert.equal(changed.status, 204);
  const stale = await PersonItem(
    request(BEN, 'PATCH', { id }, { ...otto, name: 'Otto', etag: otto.etag }),
    context
  );
  assert.equal(stale.status, 409);
  const updated = (await find())!;
  assert.equal(updated.aktiv, false);

  const deleted = await PersonItem(
    new HttpRequest({
      url: 'https://example.test/api/intern/pflege/personen',
      method: 'DELETE',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal(ANNA))).toString('base64'),
        'if-match': updated.etag,
      },
      params: { id },
    }),
    context
  );
  assert.equal(deleted.status, 204);
  assert.equal(await find(), undefined);
});
