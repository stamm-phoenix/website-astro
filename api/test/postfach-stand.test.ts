import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostfachKonversationRoute, PostfachListeRoute } from '../endpoints/intern-postfach';
import { PostfachStatusRoute } from '../endpoints/intern-postfach-status';
import type { KonversationDetail, PostfachAnsicht } from '../lib/postfach-model';
import { postfachGraph } from '../lib/postfach-graph-basis';
import { iso, K1, K2, KONTAKT, message, request, setup } from './fixtures/postfach';

type Mocks = ReturnType<typeof setup>['mocks'];

function flags(mocks: Mocks): Record<string, string> {
  return Object.fromEntries(
    mocks.postfach.map((entry) => [
      entry.id,
      (entry.flag as { flagStatus?: string } | undefined)?.flagStatus ?? '-',
    ])
  );
}

function ordner(mocks: Mocks): Record<string, unknown> {
  return Object.fromEntries(mocks.postfach.map((entry) => [entry.id, entry.parentFolderId]));
}

const status = (body: object) => request('PUT', '/kontakt/status', KONTAKT, body);

async function liste(context: ReturnType<typeof setup>['context']): Promise<PostfachAnsicht> {
  return (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
}

test('needing action is a flag, done is the archive, and new brings it back', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[2].isRead = false;
  const handeln = await PostfachStatusRoute(
    status({ konversation: K2, status: 'handlungsbedarf', vorher: 'neu', bis: iso(0.5) }),
    context
  );
  assert.equal(handeln.status, 200);
  // Something was done with it: unread messages are read in Outlook now
  assert.equal(mocks.postfach[2].isRead, true);
  assert.equal(mocks.postfach[0].isRead, undefined);
  assert.deepEqual(handeln.jsonBody, { status: 'handlungsbedarf' });
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
  assert.deepEqual(erledigt.jsonBody, { status: 'erledigt' });
  // The received ones are archived, the open flag completed; the sent answer stays in Sent Items
  assert.deepEqual(ordner(mocks), {
    AAkALgm1000000: 'FOLDER-INBOX',
    AAkALgm2000000: 'FOLDER-INBOX',
    AAkALgm3000000: 'FOLDER-ARCHIV',
    AAkALgm4000000: 'FOLDER-SENT',
    AAkALgm5000000: 'FOLDER-ARCHIV',
  });
  assert.equal(flags(mocks).AAkALgm5000000, 'complete');
  // The flag is completed before the move, each in the version it has then
  assert.deepEqual(
    mocks.moves.map((move) => move.id),
    ['AAkALgm3000000', 'AAkALgm5000000']
  );

  // The list reads inbox and archive again after a change
  const k2 = (await liste(context)).konversationen.find((zeile) => zeile.id === K2);
  assert.equal(k2?.status, 'erledigt');
  assert.equal(k2?.anzahl, 2);
  const detail = (
    await PostfachKonversationRoute(
      request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
      context
    )
  ).jsonBody as KonversationDetail;
  assert.equal(detail.konversation.status, 'erledigt');

  // Back to „Neu“ brings the archived ones back without a flag
  const neu = await PostfachStatusRoute(
    status({ konversation: K2, status: 'neu', vorher: 'erledigt', bis: iso(0.5) }),
    context
  );
  assert.equal(neu.status, 200);
  assert.equal(ordner(mocks).AAkALgm3000000, 'FOLDER-INBOX');
  assert.equal(ordner(mocks).AAkALgm5000000, 'FOLDER-INBOX');
  assert.equal(flags(mocks).AAkALgm5000000, 'notFlagged');
});

test('a reply after „Erledigt“ makes the conversation new again', async (t) => {
  const { context, mocks } = setup(t);
  await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  mocks.postfach.push(message('AAkALgm9000000', K1, 0.1, { parentFolderId: 'FOLDER-INBOX' }));
  const zeilen = (await PostfachListeRoute(request('GET', '/kontakt?frisch=1', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  const k1 = zeilen.konversationen.find((zeile) => zeile.id === K1);
  assert.equal(k1?.status, 'neu');
  assert.equal(k1?.anzahl, 1);
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
  assert.equal(mocks.moves.length, 0);
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
  });
  // The same status again changes nothing
  const gleich = await PostfachStatusRoute(
    status({ konversation: K1, status: 'handlungsbedarf', vorher: 'handlungsbedarf', bis: iso(1) }),
    context
  );
  assert.equal(gleich.status, 200);
  assert.equal(mocks.patches.length + mocks.moves.length, 0);
});

test('only what is still in the inbox is archived; a deleted conversation is reported as gone', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[0].parentFolderId = 'FOLDER-ARCHIV';
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.moves, [{ id: 'AAkALgm2000000', ziel: 'archive' }]);
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

test('filed in another folder counts as done; opening it again brings the newest back', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[0].parentFolderId = 'FOLDER-NIKOLAUS';
  mocks.postfach[1].parentFolderId = 'FOLDER-NIKOLAUS';
  assert.equal(
    (await liste(context)).konversationen.some((zeile) => zeile.id === K1),
    false
  );
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'neu', vorher: 'erledigt', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.moves, [{ id: 'AAkALgm1000000', ziel: 'inbox' }]);
});

test('without an archive in the mailbox nothing is marked done', async (t) => {
  const { context, mocks } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.includes('/mailFolders/archive'))
        throw Object.assign(new Error('not found'), { statusCode: 404 });
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  // The list still shows the inbox
  assert.equal((await liste(context)).konversationen.length, 2);
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 503);
  assert.match((response.jsonBody as { message: string }).message, /Archivordner/);
  assert.equal(mocks.moves.length, 0);
});

test('after a change that failed half way the list shows what was written', async (t) => {
  const { context, mocks } = setup(t);
  await liste(context);
  const original = postfachGraph.move;
  t.mock.method(postfachGraph, 'move', async (path: string, ziel: string, etag?: string) => {
    if (path.endsWith('AAkALgm3000000'))
      throw Object.assign(new Error('busy'), { statusCode: 503 });
    return original.call(postfachGraph, path, ziel, etag);
  });
  const response = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(0.5) }),
    context
  ).catch((error: unknown) => error);
  assert.ok(response instanceof Error || (response as { status?: number }).status === 500);
  assert.equal(ordner(mocks).AAkALgm5000000, 'FOLDER-ARCHIV');
  // Not taken from the cache of the list read before: one message is still in the inbox
  const k2 = (await liste(context)).konversationen.find((zeile) => zeile.id === K2);
  assert.equal(k2?.status, 'neu');
  assert.equal(k2?.anzahl, 1);
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
  const original = postfachGraph.move;
  t.mock.method(postfachGraph, 'move', async (path: string, ziel: string, etag?: string) => {
    if (path.endsWith('AAkALgm3000000'))
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    return original.call(postfachGraph, path, ziel, etag);
  });
  const response = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(0.5) }),
    context
  );
  assert.equal(response.status, 409);
  assert.equal(ordner(mocks).AAkALgm5000000, 'FOLDER-ARCHIV');
});

test('an archived form note still counts for the person, an archived own answer not at all', async (t) => {
  const { context, mocks } = setup(t);
  const kontakt = { emailAddress: { name: 'Kontakt', address: 'kontakt@stamm-phoenix.de' } };
  // The note of the form (to the mailbox itself) was assigned and archived
  Object.assign(mocks.postfach[4], {
    parentFolderId: 'FOLDER-ARCHIV',
    toRecipients: [kontakt],
    categories: ['👤 Tom Test'],
  });
  // An own answer to Erika, moved from „Gesendete Elemente“ into the archive
  mocks.postfach.push(
    message('AAkALgm8000000', K2, 0.2, {
      from: kontakt,
      toRecipients: [{ emailAddress: { name: 'Erika', address: 'erika@example.invalid' } }],
      parentFolderId: 'FOLDER-ARCHIV',
      categories: ['👤 Lea Leitung'],
    })
  );
  const k2 = (await liste(context)).konversationen.find((zeile) => zeile.id === K2);
  assert.equal(k2?.status, 'neu');
  assert.equal(k2?.zustaendig?.name, 'Tom Test');
  const erledigt = await PostfachStatusRoute(
    status({ konversation: K2, status: 'erledigt', vorher: 'neu', bis: iso(2) }),
    context
  );
  assert.equal(erledigt.status, 200);
  // Only the message left in the inbox is moved; the own answer is not touched
  assert.deepEqual(mocks.moves, [{ id: 'AAkALgm3000000', ziel: 'archive' }]);
});

test('a reply that arrives while archiving is not reported as done', async (t) => {
  const { context, mocks } = setup(t);
  const original = postfachGraph.move;
  let einmal = true;
  t.mock.method(postfachGraph, 'move', async (path: string, ziel: string, etag?: string) => {
    const antwort = await original.call(postfachGraph, path, ziel, etag);
    if (einmal) {
      einmal = false;
      mocks.postfach.push(message('AAkALgm9000000', K1, 0.05, { parentFolderId: 'FOLDER-INBOX' }));
    }
    return antwort;
  });
  const response = await PostfachStatusRoute(
    status({ konversation: K1, status: 'erledigt', vorher: 'neu', bis: iso(1) }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: 'neu' });
});

test('with a full inbox an archived conversation with an older message in the inbox is open', async (t) => {
  const { context, mocks } = setup(t);
  // 100 newer messages fill the inbox; K1 has its newest message archived, an older one with a
  // flag is still in the inbox beyond what the list reads
  for (let index = 0; index < 100; index++)
    mocks.postfach.push(
      message(
        `AAkALgf${String(index).padStart(7, '0')}`,
        `AAQkAGfueller${String(index).padStart(10, '0')}=`,
        0.01 * (index + 1),
        {
          parentFolderId: 'FOLDER-INBOX',
        }
      )
    );
  mocks.postfach[0].parentFolderId = 'FOLDER-ARCHIV';
  mocks.postfach[1].flag = { flagStatus: 'flagged' };
  const ansicht = await liste(context);
  assert.equal(ansicht.begrenzt, true);
  const k1 = ansicht.konversationen.find((zeile) => zeile.id === K1);
  assert.equal(k1?.status, 'handlungsbedarf');
});
