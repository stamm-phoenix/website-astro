import assert from 'node:assert/strict';
import {
  PostfachGelesenRoute,
  PostfachListeRoute,
  PostfachStartRoute,
} from '../endpoints/intern-postfach';
import { postfachGraph } from '../lib/postfach-graph';
import { resetPostfachCaches } from '../lib/postfach';
import type { PostfachAnsicht, PostfachStart } from '../lib/postfach-model';
import { getDb } from '../lib/db';
import { dbTest } from './fixtures/database';
import { INBOX, K1, K2, KONTAKT, LEA, request, setup, TOM } from './fixtures/postfach';

dbTest('the list groups the inbox and starts unread a few days back', async (t) => {
  const { context } = setup(t);
  const response = await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context);
  assert.equal(response.status, 200);
  const ansicht = response.jsonBody as PostfachAnsicht;
  assert.equal(ansicht.ich, 'lea@stamm-phoenix.de');
  assert.equal(ansicht.begrenzt, false);
  assert.equal(
    ansicht.postfach.outlookUrl,
    'https://outlook.office.com/mail/kontakt%40stamm-phoenix.de/'
  );
  assert.deepEqual(
    ansicht.konversationen.map((zeile) => [zeile.id, zeile.anzahl, zeile.ungelesen]),
    [
      [K1, 2, 1],
      [K2, 1, 1],
    ]
  );
});

dbTest('mailboxes of other teams and unknown ones are refused', async (t) => {
  const { context } = setup(t);
  const fremd = { ...LEA, userRoles: ['authenticated', 'team_leitende'] };
  const unbekannt = await PostfachListeRoute(
    request('GET', '/gibtsnicht', { postfach: 'gibtsnicht' }, undefined, fremd),
    context
  );
  assert.equal(unbekannt.status, 404);
  const anonym = await PostfachListeRoute(
    request('GET', '/kontakt', KONTAKT, undefined, null),
    context
  );
  assert.equal(anonym.status, 401);
});

dbTest('read marks belong to one person', async (t) => {
  const { context } = setup(t);
  const marked = await PostfachGelesenRoute(
    request('POST', '/kontakt/gelesen', KONTAKT, {
      nachrichten: ['AAkALgm1000000', 'AAkALgm3000000'],
      gelesen: true,
    }),
    context
  );
  assert.equal(marked.status, 204);
  const lea = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.deepEqual(
    lea.konversationen.map((zeile) => zeile.ungelesen),
    [0, 0]
  );
  const tom = (
    await PostfachListeRoute(request('GET', '/kontakt', KONTAKT, undefined, TOM), context)
  ).jsonBody as PostfachAnsicht;
  assert.deepEqual(
    tom.konversationen.map((zeile) => zeile.ungelesen),
    [1, 1]
  );

  // An old message marked unread stays unread, until all are marked read
  await PostfachGelesenRoute(
    request('POST', '/kontakt/gelesen', KONTAKT, {
      nachrichten: ['AAkALgm2000000'],
      gelesen: false,
    }),
    context
  );
  let again = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.equal(again.konversationen[0].ungelesen, 1);
  await PostfachGelesenRoute(request('POST', '/kontakt/gelesen', KONTAKT, { alle: true }), context);
  again = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  assert.deepEqual(
    again.konversationen.map((zeile) => zeile.ungelesen),
    [0, 0]
  );
  // Another person's marks stay, also old ones
  await PostfachGelesenRoute(
    request(
      'POST',
      '/kontakt/gelesen',
      KONTAKT,
      { nachrichten: ['AAkALgm3000000'], gelesen: true },
      TOM
    ),
    context
  );
  await getDb()
    .updateTable('postfach.gelesen')
    .set({ am: new Date('2020-01-01T00:00:00Z') })
    .where('user_id', '=', TOM.userId)
    .execute();
  await PostfachGelesenRoute(request('POST', '/kontakt/gelesen', KONTAKT, { alle: true }), context);
  const tomDanach = (
    await PostfachListeRoute(request('GET', '/kontakt', KONTAKT, undefined, TOM), context)
  ).jsonBody as PostfachAnsicht;
  assert.deepEqual(
    tomDanach.konversationen.map((zeile) => zeile.ungelesen),
    [1, 0]
  );
});

dbTest('a refused mailbox says whom to tell', async (t) => {
  const { context } = setup(t);
  t.mock.method(postfachGraph, 'get', async () => {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  });
  const response = await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context);
  assert.equal(response.status, 503);
  assert.match((response.jsonBody as { message: string }).message, /admin@stamm-phoenix.de/);
  const start = (await PostfachStartRoute(request('GET', '', {}), context))
    .jsonBody as PostfachStart;
  assert.equal(start.postfaecher[0].fehler, true);
});

dbTest('a full inbox says that older messages are only in Outlook', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/mailFolders/inbox/messages'))
        return { value: INBOX, '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context);
  assert.equal((response.jsonBody as PostfachAnsicht).begrenzt, true);
});

dbTest('the start page tells a refused mailbox apart from one that failed for now', async (t) => {
  const { context } = setup(t);
  t.mock.method(postfachGraph, 'get', async () => {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  });
  const start = (await PostfachStartRoute(request('GET', '', {}), context))
    .jsonBody as PostfachStart;
  assert.deepEqual(
    start.postfaecher.map((postfach) => [postfach.fehler, postfach.gesperrt]),
    [[true, true]]
  );
  t.mock.method(postfachGraph, 'get', async () => {
    throw new Error('timeout');
  });
  resetPostfachCaches();
  const again = (await PostfachStartRoute(request('GET', '', {}), context))
    .jsonBody as PostfachStart;
  assert.deepEqual(
    again.postfaecher.map((postfach) => [postfach.fehler, postfach.gesperrt]),
    [[true, false]]
  );
});
