import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostfachKonversationRoute, PostfachListeRoute } from '../endpoints/intern-postfach';
import { PostfachStatusRoute } from '../endpoints/intern-postfach-status';
import type { KonversationDetail, PostfachAnsicht } from '../lib/postfach-model';
import { postfachGraph } from '../lib/postfach-graph-basis';
import { iso, K1, K2, KONTAKT, message, request, setup } from './fixtures/postfach';

function flags(mocks: { postfach: Record<string, unknown>[] }): Record<string, string> {
  return Object.fromEntries(
    mocks.postfach.map((entry) => [
      entry.id,
      (entry.flag as { flagStatus?: string } | undefined)?.flagStatus ?? '-',
    ])
  );
}

const status = (body: object) => request('PUT', '/kontakt/status', KONTAKT, body);

test('the status is written as flags into Outlook and read back from there', async (t) => {
  const { context, mocks } = setup(t);
  const handeln = await PostfachStatusRoute(
    status({ konversation: K2, status: 'handlungsbedarf', vorher: 'neu', bis: iso(0.5) }),
    context
  );
  assert.equal(handeln.status, 200);
  assert.deepEqual(handeln.jsonBody, { status: 'handlungsbedarf', erledigtAm: null });
  // Only the newest received message carries the flag; the sent answer is left alone
  assert.deepEqual(flags(mocks), {
    AAkALgm1000000: '-',
    AAkALgm2000000: '-',
    AAkALgm3000000: '-',
    AAkALgm4000000: '-',
    AAkALgm5000000: 'flagged',
  });

  const erledigt = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'handlungsbedarf', bis: iso(0.5) }),
    context
  );
  assert.equal(erledigt.status, 200);
  const body = erledigt.jsonBody as { status: string; erledigtAm: string };
  assert.equal(body.status, 'erledigt');
  assert.ok(Date.parse(body.erledigtAm) > Date.now() - 60_000);
  assert.equal(flags(mocks).AAkALgm3000000, 'complete');
  assert.equal(flags(mocks).AAkALgm5000000, 'complete');
  assert.equal(flags(mocks).AAkALgm4000000, '-');

  // The list reads the inbox again after a change
  const liste = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.equal(liste.konversationen.find((zeile) => zeile.id === K2)?.status, 'erledigt');
  const detail = (
    await PostfachKonversationRoute(
      request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
      context
    )
  ).jsonBody as KonversationDetail;
  assert.equal(detail.konversation.status, 'erledigt');

  // Back to „Neu“ takes every flag off
  const neu = await PostfachStatusRoute(
    status({ konversation: K2, status: 'neu', vorher: 'erledigt', bis: iso(0.5) }),
    context
  );
  assert.equal(neu.status, 200);
  assert.equal(flags(mocks).AAkALgm3000000, 'notFlagged');
  assert.equal(flags(mocks).AAkALgm5000000, 'notFlagged');
});

test('a reply after „Erledigt“ makes the conversation new again', async (t) => {
  const { context, mocks } = setup(t);
  await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  mocks.postfach.push(message('AAkALgm9000000', K1, 0.1, { parentFolderId: 'FOLDER-INBOX' }));
  const liste = (await PostfachListeRoute(request('GET', '/kontakt?frisch=1', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.equal(liste.konversationen.find((zeile) => zeile.id === K1)?.status, 'neu');
  // A page that still shows „Erledigt“ is told
  const stale = await PostfachStatusRoute(
    status({ konversation: K1, status: 'handlungsbedarf', vorher: 'erledigt', bis: iso(1) }),
    context
  );
  assert.equal(stale.status, 409);
  assert.match((stale.jsonBody as { message: string }).message, /wieder neu/);
});

test('marking refuses when a newer message arrived than the page showed', async (t) => {
  const { context, mocks } = setup(t);
  const response = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(2) }),
    context
  );
  assert.equal(response.status, 409);
  assert.equal((response.jsonBody as { code: string }).code, 'NEUE_NACHRICHT');
  assert.equal(mocks.patches.length, 0);
});

test('a status set in Outlook meanwhile is not overwritten', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[0].flag = { flagStatus: 'flagged' };
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 409);
  assert.deepEqual(response.jsonBody, {
    error: 'CONFLICT',
    code: 'CONFLICT',
    message: 'Jemand hat sie inzwischen mit „Handlungsbedarf“ markiert. Nichts wurde gespeichert.',
    status: 'handlungsbedarf',
    erledigtAm: null,
  });
  // The same status again changes nothing
  const gleich = await PostfachStatusRoute(
    status({ konversation: K1, status: 'handlungsbedarf', vorher: 'handlungsbedarf', bis: iso(1) }),
    context
  );
  assert.equal(gleich.status, 200);
  assert.equal(mocks.patches.length, 0);
});

test('an archived message counts, a deleted conversation is reported as gone', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[0].parentFolderId = 'FOLDER-ARCHIV';
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(flags(mocks).AAkALgm1000000, 'complete');
  const weg = await PostfachStatusRoute(
    status({
      konversation: 'AAQkAGkonversation9999999999=',
      status: 'erledigt',
      vorher: 'neu',
      bis: iso(1),
    }),
    context
  );
  assert.equal(weg.status, 404);
});

test('an archived message with a flag counts in the list as in the reading view', async (t) => {
  const { context, mocks } = setup(t);
  // The newest message of K1 needs action and was archived; the older one stays in the inbox
  Object.assign(mocks.postfach[0], {
    parentFolderId: 'FOLDER-ARCHIV',
    flag: { flagStatus: 'flagged' },
    categories: ['👤 Tom Test'],
  });
  const liste = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  const k1 = liste.konversationen.find((zeile) => zeile.id === K1);
  assert.equal(k1?.status, 'handlungsbedarf');
  assert.equal(k1?.zustaendig?.name, 'Tom Test');
  assert.equal(k1?.anzahl, 1);
});

test('after a change that failed half way the list shows what was written', async (t) => {
  const { context, mocks } = setup(t);
  await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context);
  const original = postfachGraph.patch;
  t.mock.method(postfachGraph, 'patch', async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('AAkALgm3000000'))
      throw Object.assign(new Error('busy'), { statusCode: 503 });
    return original.call(postfachGraph, path, body);
  });
  const response = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(0.5) }),
    context
  ).catch((error: unknown) => error);
  assert.ok(response instanceof Error || (response as { status?: number }).status === 500);
  assert.equal(flags(mocks).AAkALgm5000000, 'complete');
  // Not taken from the cache of the list read before
  const liste = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.equal(liste.konversationen.find((zeile) => zeile.id === K2)?.status, 'erledigt');
});

test('a conversation longer than a change reads is left to Outlook', async (t) => {
  const { context, mocks } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      const antwort = await original.call(postfachGraph, path, query, prefer);
      if (query?.$filter?.includes(K1))
        return {
          ...(antwort as object),
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/users/kontakt%40stamm-phoenix.de/messages?$skip=50',
        };
      return antwort;
    }
  );
  t.mock.method(postfachGraph, 'next', async () => ({
    value: [],
    '@odata.nextLink':
      'https://graph.microsoft.com/v1.0/users/kontakt%40stamm-phoenix.de/messages?$skip=100',
  }));
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 422);
  assert.match((response.jsonBody as { message: string }).message, /Outlook/);
  assert.equal(mocks.patches.length, 0);
});

test('a message deleted while it is changed is not reported as saved', async (t) => {
  const { context, mocks } = setup(t);
  const original = postfachGraph.patch;
  t.mock.method(
    postfachGraph,
    'patch',
    async (path: string, body: Record<string, unknown>, etag?: string) => {
      if (path.endsWith('AAkALgm3000000'))
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      return original.call(postfachGraph, path, body, etag);
    }
  );
  const response = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(0.5) }),
    context
  );
  assert.equal(response.status, 409);
  assert.equal(flags(mocks).AAkALgm5000000, 'complete');
});
