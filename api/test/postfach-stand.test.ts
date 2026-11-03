import assert from 'node:assert/strict';
import {
  PostfachKonversationRoute,
  PostfachListeRoute,
  PostfachStartRoute,
  PostfachZustaendigRoute,
} from '../endpoints/intern-postfach';
import { PostfachStatusRoute } from '../endpoints/intern-postfach-status';
import type { KonversationDetail, PostfachAnsicht, PostfachStart } from '../lib/postfach-model';
import { getDb } from '../lib/db';
import { dbTest } from './fixtures/database';
import { iso, K2, KONTAKT, NOW, request, setup, TOM } from './fixtures/postfach';

dbTest(
  'a conversation is marked done for everyone and opens again with a newer message',
  async (t) => {
    const { context } = setup(t);
    await PostfachZustaendigRoute(
      request('PUT', '/kontakt/zustaendig', KONTAKT, {
        konversation: K2,
        login: 'tom@stamm-phoenix.de',
      }),
      context
    );
    const done = await PostfachStatusRoute(
      request(
        'PUT',
        '/kontakt/status',
        KONTAKT,
        { konversation: K2, status: 'erledigt', vorher: 'offen', bis: iso(0.5) },
        TOM
      ),
      context
    );
    assert.equal(done.status, 200);
    assert.equal((done.jsonBody as { erledigung: { name: string } }).erledigung.name, 'Tom Test');

    const lea = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
      .jsonBody as PostfachAnsicht;
    const zeile = lea.konversationen.find((entry) => entry.id === K2)!;
    assert.equal(zeile.erledigung?.status, 'erledigt');
    assert.equal(zeile.wiederOffen, false);
    // Done conversations leave the start page, also unread ones
    const start = (await PostfachStartRoute(request('GET', '', {}, undefined, TOM), context))
      .jsonBody as PostfachStart;
    assert.equal(
      start.fuerMich.some((entry) => entry.id === K2),
      false
    );
    assert.equal(start.postfaecher[0].mirZugewiesen, 0);

    // A stale page gets a conflict naming the status
    const stale = await PostfachStatusRoute(
      request('PUT', '/kontakt/status', KONTAKT, {
        konversation: K2,
        status: 'kein_handlungsbedarf',
        vorher: 'offen',
        bis: iso(0.5),
      }),
      context
    );
    assert.equal(stale.status, 409);
    assert.match(
      (stale.jsonBody as { message: string }).message,
      /Tom Test hat sie inzwischen als erledigt markiert/
    );

    // A reply that arrives after the mark opens it again
    await getDb()
      .updateTable('postfach.erledigung')
      .set({ bis: new Date(NOW - 3 * 3_600_000) })
      .execute();
    const again = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
      .jsonBody as PostfachAnsicht;
    const offen = again.konversationen.find((entry) => entry.id === K2)!;
    assert.equal(offen.erledigung, null);
    assert.equal(offen.wiederOffen, true);
    const reopen = await PostfachStatusRoute(
      request('PUT', '/kontakt/status', KONTAKT, {
        konversation: K2,
        status: 'kein_handlungsbedarf',
        vorher: 'offen',
        bis: iso(0.5),
      }),
      context
    );
    assert.equal(reopen.status, 200);
    const back = await PostfachStatusRoute(
      request('PUT', '/kontakt/status', KONTAKT, {
        konversation: K2,
        status: 'offen',
        vorher: 'kein_handlungsbedarf',
        bis: iso(0.5),
      }),
      context
    );
    assert.equal((back.jsonBody as { erledigung: unknown }).erledigung, null);
    assert.equal(
      await getDb().selectFrom('postfach.erledigung').select('postfach').executeTakeFirst(),
      undefined
    );
  }
);

dbTest('marking done refuses when a newer message arrived than the page showed', async (t) => {
  const { context } = setup(t);
  const stale = await PostfachStatusRoute(
    request('PUT', '/kontakt/status', KONTAKT, {
      konversation: K2,
      status: 'erledigt',
      vorher: 'offen',
      bis: iso(5),
    }),
    context
  );
  assert.equal(stale.status, 409);
  assert.match((stale.jsonBody as { message: string }).message, /neue Nachricht gekommen/);
  assert.equal(
    await getDb().selectFrom('postfach.erledigung').select('postfach').executeTakeFirst(),
    undefined
  );
});

dbTest(
  'a later reply that was archived counts for the status, as in the reading view',
  async (t) => {
    const { context } = setup(t);
    // Done up to the message in the inbox (2 h ago); a later reply (0.5 h ago) was archived
    await getDb()
      .insertInto('postfach.erledigung')
      .values({
        postfach: 'kontakt',
        konversation_id: K2,
        status: 'erledigt',
        login: 'tom@stamm-phoenix.de',
        name: 'Tom Test',
        bis: new Date(iso(2)),
      })
      .execute();
    const detail = (
      await PostfachKonversationRoute(
        request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
        context
      )
    ).jsonBody as KonversationDetail;
    assert.equal(detail.konversation.erledigung, null);
    assert.equal(detail.konversation.wiederOffen, true);
    const done = await PostfachStatusRoute(
      request('PUT', '/kontakt/status', KONTAKT, {
        konversation: K2,
        status: 'erledigt',
        vorher: 'offen',
        bis: detail.konversation.am,
      }),
      context
    );
    assert.equal(done.status, 200);
  }
);

dbTest('a mark covers what the mailbox holds, even when the page names a later time', async (t) => {
  const { context } = setup(t);
  const done = await PostfachStatusRoute(
    request('PUT', '/kontakt/status', KONTAKT, {
      konversation: K2,
      status: 'erledigt',
      vorher: 'offen',
      bis: '9999-12-31T00:00:00.000Z',
    }),
    context
  );
  assert.equal(done.status, 200);
  const row = await getDb()
    .selectFrom('postfach.erledigung')
    .select('bis')
    .executeTakeFirstOrThrow();
  assert.equal(row.bis?.toISOString().slice(0, 19), iso(0.5).slice(0, 19));
});
