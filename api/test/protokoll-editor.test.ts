import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EditorCollection,
  EditorItem,
  EditorSperre,
  GetEditorLive,
  GetEditorProtokoll,
  GetEditorRevision,
  GetEditorRevisions,
} from '../endpoints/intern-protokoll-editor';
import { seedPreviewProtokollEditor } from '../lib/db-preview';
import * as leitendeList from '../lib/leitende-list';
import { ValidationError, validateProtokollInhalt } from '../lib/pflege-validation';
import { getEditorOverview, saveEditorProtokoll, takeSperre } from '../lib/protokoll-editor';
import type {
  ProtokollEditorDetail,
  ProtokollInhalt,
  ProtokollLiveResponse,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollSaveResponse,
} from '../lib/protokoll-editor-model';
import {
  SPERRE_SECONDS,
  aktionZeitraum,
  neuerInhalt,
  parseProtokollText,
} from '../lib/protokoll-editor-model';
import * as taskDirectory from '../lib/task-directory';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.beobachter@stamm-phoenix.de';
const TOKEN_A = 'tab-a-0123456789abcdef';
const TOKEN_B = 'tab-b-0123456789abcdef';

function principal(login: string) {
  return {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated'],
  };
}

function request(
  login: string,
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  query = ''
): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/protokoll-editor${query}`,
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal(login))).toString('base64'),
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
  assert.equal(detail.inhalt.kopf.sitzungsleitung, 'Vera Vorstand');
  assert.equal(detail.inhalt.kopf.protokollant, 'Anna Autorin');
  assert.deepEqual(
    detail.inhalt.punkte.map((p) => [p.titel, p.unterpunkte.map((u) => u.titel)]),
    [
      ['Stufenberichte', ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'StaVos']],
      ['Reflexion', []],
      ['Planung', []],
      ['Sonstiges', []],
    ]
  );
  assert.equal(detail.sperre, null);
  assert.equal(detail.canDelete, true);
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

dbTest('only the author or a reviewer deletes a draft', async (t) => {
  mockDirectory(t);
  const context = quietContext(t);
  const detail = await create(t);
  const params = { id: String(detail.id) };
  const refused = await EditorItem(request(BEN, 'DELETE', params), context);
  assert.equal(refused.status, 400);
  const deleted = await EditorItem(request(ANNA, 'DELETE', params), context);
  assert.equal(deleted.status, 204);
  const gone = await GetEditorProtokoll(request(ANNA, 'GET', params), context);
  assert.equal(gone.status, 404);
});

dbTest('the preview gets invented minutes once', async () => {
  await seedPreviewProtokollEditor(new Date('2026-10-14T12:00:00Z'));
  await seedPreviewProtokollEditor(new Date('2026-10-14T12:00:00Z'));
  const overview = await getEditorOverview();
  assert.equal(overview.protokolle.length, 1);
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

test('the few text marks become paragraphs, lists and bold spans', () => {
  assert.deepEqual(parseProtokollText('Ein **wichtiger** Satz\nzweite Zeile\n\n- a\n* b'), [
    {
      kind: 'absatz',
      lines: [
        [
          { text: 'Ein ', bold: false },
          { text: 'wichtiger', bold: true },
          { text: ' Satz', bold: false },
        ],
        [{ text: 'zweite Zeile', bold: false }],
      ],
    },
    { kind: 'liste', items: [[{ text: 'a', bold: false }], [{ text: 'b', bold: false }]] },
  ]);
  assert.deepEqual(parseProtokollText('<b>kein HTML</b>'), [
    { kind: 'absatz', lines: [[{ text: '<b>kein HTML</b>', bold: false }]] },
  ]);
});

test('the dates of an Aktion are written compactly', () => {
  const aktion = { id: 'evt_1', titel: 'Lager', start: '2026-06-12', ende: '2026-06-14' };
  assert.equal(aktionZeitraum(aktion), '12.–14.06.2026');
  assert.equal(aktionZeitraum({ ...aktion, ende: '2026-07-02' }), '12.06.–02.07.2026');
  assert.equal(aktionZeitraum({ ...aktion, ende: '' }), '12.06.2026');
  assert.equal(aktionZeitraum({ ...aktion, start: '', ende: '' }), '');
});
