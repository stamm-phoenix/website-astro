import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../lib/config';
import { PostfachListeRoute, PostfachStartRoute } from '../endpoints/intern-postfach';
import { postfachGraph } from '../lib/postfach-graph';
import { resetPostfachCaches, sichtbarePostfaecher } from '../lib/postfach';
import type { PostfachAnsicht, PostfachStart } from '../lib/postfach-model';
import { K1, K2, KONTAKT, LEA, message, request, setup, TOM } from './fixtures/postfach';

test('the list groups the inbox and takes status and person from Outlook', async (t) => {
  const { context, mocks } = setup(t);
  // Archived as done, then a reply: new again. The other one has a flag and a person
  Object.assign(mocks.postfach[1], { parentFolderId: 'FOLDER-ARCHIV' });
  Object.assign(mocks.postfach[2], {
    flag: { flagStatus: 'flagged' },
    categories: ['👤 Tom Test', 'Rechnung'],
  });
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
    ansicht.konversationen.map((zeile) => [
      zeile.id,
      zeile.anzahl,
      zeile.status,
      zeile.zustaendig?.login ?? null,
    ]),
    [
      [K2, 2, 'handlungsbedarf', 'tom@stamm-phoenix.de'],
      [K1, 1, 'neu', null],
    ]
  );
});

test('an archived conversation shows as done, and an unknown person keeps the name', async (t) => {
  const { context, mocks } = setup(t);
  for (const entry of mocks.postfach.filter((candidate) => candidate.conversationId === K1))
    Object.assign(entry, { parentFolderId: 'FOLDER-ARCHIV', categories: ['👤 Altleiter Anton'] });
  const ansicht = (await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context))
    .jsonBody as PostfachAnsicht;
  const k1 = ansicht.konversationen.find((zeile) => zeile.id === K1);
  assert.equal(k1?.status, 'erledigt');
  assert.equal(k1?.anzahl, 2);
  assert.deepEqual(k1?.zustaendig, { login: null, name: 'Altleiter Anton' });
});

test('the start page shows new ones to everyone and flagged ones to the person or to all', async (t) => {
  const { context, mocks } = setup(t);
  const k3 = 'AAQkAGkonversation3333333333=';
  const k4 = 'AAQkAGkonversation4444444444=';
  mocks.postfach.push(
    message('AAkALgm6000000', k3, 3, {
      parentFolderId: 'FOLDER-INBOX',
      flag: { flagStatus: 'flagged' },
    }),
    message('AAkALgm7000000', k4, 4, { parentFolderId: 'FOLDER-ARCHIV' })
  );
  Object.assign(mocks.postfach[2], {
    flag: { flagStatus: 'flagged' },
    categories: ['👤 Tom Test'],
  });
  const fuer = async (wer: typeof LEA) =>
    (await PostfachStartRoute(request('GET', '', {}, undefined, wer), context))
      .jsonBody as PostfachStart;
  const lea = await fuer(LEA);
  assert.deepEqual(
    lea.fuerMich.map((zeile) => zeile.id),
    [K1, k3]
  );
  assert.deepEqual(
    lea.postfaecher.map((postfach) => [postfach.neu, postfach.mirZugewiesen]),
    [[1, 0]]
  );
  const tom = await fuer(TOM);
  assert.deepEqual(
    tom.fuerMich.map((zeile) => zeile.id),
    [K2, K1, k3]
  );
  assert.equal(tom.postfaecher[0].mirZugewiesen, 1);
});

test('mailboxes of other teams and unknown ones are refused', async (t) => {
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

test('a refused mailbox says whom to tell', async (t) => {
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

test('a full inbox says that older messages are only in Outlook', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/mailFolders/inbox/messages'))
        return {
          value: [message('AAkALgm1000000', K1, 1)],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
        };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachListeRoute(request('GET', '/kontakt', KONTAKT), context);
  assert.equal((response.jsonBody as PostfachAnsicht).begrenzt, true);
});

test('the start page tells a refused mailbox apart from one that failed for now', async (t) => {
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

test('the preview test account sees only the mailbox of the Leitende, whatever its roles', () => {
  // On previews it gets every team role without being in the teams, and previews read real mail
  const alleRollen = Object.values(CONFIG.staff.teams).map((team) => team.role);
  const testkonto = {
    userDetails: CONFIG.staff.previewOnlyLogins[0],
    userRoles: ['authenticated', ...alleRollen],
  };
  assert.deepEqual(
    sichtbarePostfaecher(testkonto).map((postfach) => postfach.id),
    ['kontakt']
  );
  // A real member of all teams keeps all four
  assert.deepEqual(
    sichtbarePostfaecher({ ...testkonto, userDetails: 'lea@stamm-phoenix.de' })
      .map((postfach) => postfach.id)
      .sort(),
    ['admin', 'kontakt', 'verein', 'vorstand']
  );
});
