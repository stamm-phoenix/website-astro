import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EditorCollection,
  EditorItem,
  EditorSperre,
} from '../endpoints/intern-protokoll-editor-bearbeiten';
import { EditorReview } from '../endpoints/intern-protokoll-editor-review';
import {
  GetEditorProtokoll,
  GetEditorRevision,
  GetEditorRevisions,
} from '../endpoints/intern-protokoll-editor';
import { KorrekturUebernehmen } from '../endpoints/intern-protokoll-korrektur';
import { getDb } from '../lib/db';
import * as leitendeList from '../lib/leitende-list';
import type {
  ProtokollEditorDetail,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollSaveResponse,
} from '../lib/protokoll-editor-model';
import type { KorrekturUebernahmeResponse } from '../lib/protokoll-korrektur-model';
import * as taskDirectory from '../lib/task-directory';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.beobachter@stamm-phoenix.de';
const TOKEN = 'tab-a-0123456789abcdef';

function request(
  login: string,
  method: string,
  id: number,
  body?: unknown,
  params: Record<string, string> = {}
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
    params: { id: String(id), ...params },
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'protokoll-korrektur-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  t.mock.method(context, 'warn', () => undefined);
  return context;
}

function mockDirectory(t: TestContext): void {
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Autorin', givenName: 'Anna' },
  ]);
  t.mock.method(leitendeList, 'getLeitende', async () => []);
}

async function load(t: TestContext, id: number): Promise<ProtokollEditorDetail> {
  const loaded = await GetEditorProtokoll(request(ANNA, 'GET', id), quietContext(t));
  return loaded.jsonBody as ProtokollEditorDetail;
}

/** Minutes whose first item says „Wir fahren ins Zeltlagr.“, written and closed by Anna. */
async function written(t: TestContext): Promise<ProtokollEditorDetail> {
  mockDirectory(t);
  const context = quietContext(t);
  const created = await EditorCollection(
    request(ANNA, 'POST', 0, { title: 'Leitendenrunde', date: '2026-10-14' }),
    context
  );
  const { id } = created.jsonBody as { id: number };
  const detail = await load(t, id);
  const [first, ...rest] = detail.inhalt.punkte;
  const saved = await EditorItem(
    request(ANNA, 'PUT', id, {
      token: TOKEN,
      etag: detail.etag,
      title: detail.title,
      date: detail.date,
      inhalt: {
        ...detail.inhalt,
        punkte: [{ ...first, text: 'Wir fahren ins Zeltlagr.' }, ...rest],
      },
      aktiverPunkt: null,
    }),
    context
  );
  assert.equal(saved.status, 200);
  await EditorSperre(request(ANNA, 'DELETE', id, { token: TOKEN }), context);
  return load(t, id);
}

function vorschlag(detail: ProtokollEditorDetail, id: string, vorher: string, nachher: string) {
  return { id, punktId: detail.inhalt.punkte[0].id, feld: 'text', vorher, nachher };
}

dbTest('a proposal is taken over like a save and the earlier version is kept', async (t) => {
  const detail = await written(t);
  const context = quietContext(t);
  const result = await KorrekturUebernehmen(
    request(BEN, 'POST', detail.id, {
      etag: detail.etag,
      vorschlaege: [
        vorschlag(detail, 'k1', 'Zeltlagr', 'Zeltlager'),
        // The passage is no longer there
        vorschlag(detail, 'k2', 'Sommerlagr', 'Sommerlager'),
      ],
    }),
    context
  );
  assert.equal(result.status, 200);
  const body = result.jsonBody as KorrekturUebernahmeResponse;
  assert.deepEqual(body.uebernommen, ['k1']);
  assert.deepEqual(body.geaendert, ['k2']);

  const after = await load(t, detail.id);
  assert.equal(after.inhalt.punkte[0].text, 'Wir fahren ins Zeltlager.');
  assert.equal(after.etag, body.etag);
  assert.equal(after.updatedBy, BEN);

  const revisions = (await GetEditorRevisions(request(BEN, 'GET', detail.id), context))
    .jsonBody as ProtokollRevisionListItem[];
  assert.equal(revisions[0].reason, 'korrektur');
  assert.equal(revisions[0].savedBy, BEN);
  const before = await GetEditorRevision(
    request(BEN, 'GET', detail.id, undefined, { revisionId: String(revisions[0].id) }),
    context
  );
  assert.equal(
    (before.jsonBody as ProtokollRevision).inhalt.punkte[0].text,
    'Wir fahren ins Zeltlagr.'
  );
});

dbTest('a changed passage changes nothing and keeps no version', async (t) => {
  const detail = await written(t);
  const context = quietContext(t);
  const result = await KorrekturUebernehmen(
    request(BEN, 'POST', detail.id, {
      etag: detail.etag,
      vorschlaege: [
        vorschlag(detail, 'k1', 'Zeltlagr.', 'Zeltlager.'),
        vorschlag(detail, 'k2', 'fahren', 'fahren'),
      ],
    }),
    context
  );
  assert.equal(result.status, 200);
  // „fahren“ → „fahren“ changes nothing and counts as no longer fitting
  assert.deepEqual((result.jsonBody as KorrekturUebernahmeResponse).geaendert, ['k2']);

  const stale = await KorrekturUebernehmen(
    request(BEN, 'POST', detail.id, {
      etag: detail.etag,
      vorschlaege: [vorschlag(detail, 'k3', 'Wir', 'Ihr')],
    }),
    context
  );
  assert.equal(stale.status, 409);

  const current = await load(t, detail.id);
  const gone = await KorrekturUebernehmen(
    request(BEN, 'POST', detail.id, {
      etag: current.etag,
      vorschlaege: [vorschlag(detail, 'k1', 'Zeltlagr.', 'Zeltlager.')],
    }),
    context
  );
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.jsonBody, {
    etag: current.etag,
    updatedAt: current.updatedAt,
    uebernommen: [],
    geaendert: ['k1'],
  });
  const revisions = (await GetEditorRevisions(request(BEN, 'GET', detail.id), context))
    .jsonBody as ProtokollRevisionListItem[];
  assert.equal(revisions.filter((r) => r.reason === 'korrektur').length, 1);
});

dbTest(
  'proposals wait while someone writes, go in review and are refused after approval',
  async (t) => {
    const detail = await written(t);
    const context = quietContext(t);
    const lock = await EditorSperre(request(ANNA, 'POST', detail.id, { token: TOKEN }), context);
    const { etag } = lock.jsonBody as ProtokollSaveResponse;
    const body = { etag, vorschlaege: [vorschlag(detail, 'k1', 'Zeltlagr', 'Zeltlager')] };
    const locked = await KorrekturUebernehmen(request(BEN, 'POST', detail.id, body), context);
    assert.equal(locked.status, 423);
    assert.match((locked.jsonBody as { message: string }).message, /Anna Autorin schreibt gerade/);
    await EditorSperre(request(ANNA, 'DELETE', detail.id, { token: TOKEN }), context);

    // In review, the reviewer takes proposals over
    const review = await EditorReview(
      request(ANNA, 'POST', detail.id, { action: 'review', etag, token: null }),
      context
    );
    assert.equal(review.status, 200);
    const inReview = await load(t, detail.id);
    const taken = await KorrekturUebernehmen(
      request(BEN, 'POST', detail.id, { ...body, etag: inReview.etag }),
      context
    );
    assert.equal(taken.status, 200);
    assert.deepEqual((taken.jsonBody as KorrekturUebernahmeResponse).uebernommen, ['k1']);

    await getDb()
      .updateTable('protokoll.protokoll')
      .set({ status: 'freigegeben' })
      .where('id', '=', detail.id)
      .execute();
    const approved = await load(t, detail.id);
    const refused = await KorrekturUebernehmen(
      request(BEN, 'POST', detail.id, {
        etag: approved.etag,
        vorschlaege: [vorschlag(detail, 'k2', 'Zeltlager', 'Zeltlager!')],
      }),
      context
    );
    assert.equal(refused.status, 409);
    assert.equal((await load(t, detail.id)).inhalt.punkte[0].text, 'Wir fahren ins Zeltlager.');
  }
);
