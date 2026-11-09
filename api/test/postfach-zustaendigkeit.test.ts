import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PostfachPersonenRoute,
  PostfachStartRoute,
  PostfachZustaendigRoute,
} from '../endpoints/intern-postfach';
import { postfachVerzeichnis } from '../lib/postfach';
import { postfachGraph } from '../lib/postfach-graph-basis';
import type { PostfachStart } from '../lib/postfach-model';
import { CONFIG } from '../lib/config';
import { PostfachZustaendigMehrereRoute } from '../endpoints/intern-postfach-mehrere';
import { overrideConfig } from './fixtures/config';
import { K1, K2, KONTAKT, LEA, request, setup, TOM } from './fixtures/postfach';

function kategorien(mocks: { postfach: Record<string, unknown>[] }, id: string): unknown {
  return mocks.postfach.find((entry) => entry.id === id)?.categories;
}

function flag(mocks: { postfach: Record<string, unknown>[] }, id: string): unknown {
  return (mocks.postfach.find((entry) => entry.id === id)?.flag as { flagStatus?: string })
    ?.flagStatus;
}

test('assigning writes the category into Outlook, flags a new one and notifies the person', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[2].categories = ['Rechnung'];
  const response = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: 'tom@stamm-phoenix.de',
      vorher: null,
    }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, {
    zustaendig: { login: 'tom@stamm-phoenix.de', name: 'Tom Test' },
    status: 'handlungsbedarf',
    erledigtAm: null,
    benachrichtigt: true,
  });
  // Every received message gets the person, other categories stay; the sent one is left alone
  assert.deepEqual(kategorien(mocks, 'AAkALgm3000000'), ['Rechnung', '👤 Tom Test']);
  assert.deepEqual(kategorien(mocks, 'AAkALgm5000000'), ['👤 Tom Test']);
  assert.equal(kategorien(mocks, 'AAkALgm4000000'), undefined);
  // The newest received message carries the flag
  assert.equal(flag(mocks, 'AAkALgm5000000'), 'flagged');
  assert.equal(flag(mocks, 'AAkALgm3000000'), undefined);
  assert.deepEqual(mocks.kategorien, ['👤 Tom Test']);
  assert.equal(mocks.mails.length, 1);
  assert.equal(mocks.mails[0][0], 'tom@stamm-phoenix.de');
  assert.equal(mocks.mails[0][3], 'Lea Leitung');

  const start = (await PostfachStartRoute(request('GET', '', {}, undefined, TOM), context))
    .jsonBody as PostfachStart;
  assert.deepEqual(
    start.fuerMich.map((zeile) => [zeile.id, zeile.status]),
    [
      [K2, 'handlungsbedarf'],
      [K1, 'neu'],
    ]
  );

  // Taking it over oneself sends no note; a stale page gets a conflict naming the current person
  const self = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: 'lea@stamm-phoenix.de',
      vorher: 'Tom Test',
    }),
    context
  );
  assert.equal(self.status, 200);
  assert.deepEqual(kategorien(mocks, 'AAkALgm3000000'), ['Rechnung', '👤 Lea Leitung']);
  assert.equal(mocks.mails.length, 1);
  const stale = await PostfachZustaendigRoute(
    request(
      'PUT',
      '/kontakt/zustaendig',
      KONTAKT,
      { konversation: K2, login: null, vorher: 'Tom Test' },
      TOM
    ),
    context
  );
  assert.equal(stale.status, 409);
  assert.match((stale.jsonBody as { message: string }).message, /Lea Leitung ist jetzt zuständig/);
  assert.deepEqual(kategorien(mocks, 'AAkALgm3000000'), ['Rechnung', '👤 Lea Leitung']);

  // Removing the person keeps the flag: someone still has to act
  const weg = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: null,
      vorher: 'Lea Leitung',
    }),
    context
  );
  assert.equal(weg.status, 200);
  assert.deepEqual(kategorien(mocks, 'AAkALgm3000000'), ['Rechnung']);
  assert.equal(flag(mocks, 'AAkALgm5000000'), 'flagged');
});

test('a person set in Outlook counts as the one the page has to name', async (t) => {
  const { context, mocks } = setup(t);
  mocks.postfach[0].categories = ['👤 Tom Test'];
  const response = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K1,
      login: 'lea@stamm-phoenix.de',
      vorher: null,
    }),
    context
  );
  assert.equal(response.status, 409);
  assert.deepEqual((response.jsonBody as { zustaendig: unknown }).zustaendig, {
    login: 'tom@stamm-phoenix.de',
    name: 'Tom Test',
  });
  assert.equal(mocks.patches.length, 0);
});

test('only members of the teams can be made responsible', async (t) => {
  const { context } = setup(t);
  const response = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: 'fremd@example.invalid',
    }),
    context
  );
  assert.equal(response.status, 400);
});

test('only members who are also Leitende can be made responsible for a team mailbox', async (t) => {
  const { context } = setup(t);
  t.mock.method(postfachVerzeichnis, 'lesen', async (_signal: AbortSignal, groupId: string) =>
    groupId === CONFIG.staff.teams.verein.groupId
      ? [
          { login: 'tom@stamm-phoenix.de', name: 'Tom Test', givenName: 'Tom' },
          { login: 'vera@stamm-phoenix.de', name: 'Vera Verein', givenName: 'Vera' },
        ]
      : [
          { login: 'lea@stamm-phoenix.de', name: 'Lea Leitung', givenName: 'Lea' },
          { login: 'tom@stamm-phoenix.de', name: 'Tom Test', givenName: 'Tom' },
        ]
  );
  const verein = { ...LEA, userRoles: ['authenticated', 'team_leitende', 'team_verein'] };
  const params = { postfach: 'verein' };
  const personen = await PostfachPersonenRoute(
    request('GET', '/verein/personen', params, undefined, verein),
    context
  );
  assert.deepEqual(
    (personen.jsonBody as { personen: { login: string }[] }).personen.map((p) => p.login),
    ['tom@stamm-phoenix.de']
  );
  const vera = await PostfachZustaendigRoute(
    request(
      'PUT',
      '/verein/zustaendig',
      params,
      { konversation: K2, login: 'vera@stamm-phoenix.de' },
      verein
    ),
    context
  );
  assert.equal(vera.status, 400);
  const ohneTeam = await PostfachPersonenRoute(request('GET', '/verein/personen', params), context);
  assert.equal(ohneTeam.status, 403);
});

test('several conversations are assigned at once with one note, a stale one stays as it is', async (t) => {
  const { context, mocks } = setup(t);
  // K1 was taken by Lea in Outlook meanwhile; the page still shows nobody
  mocks.postfach[0].categories = ['👤 Lea Leitung'];
  const response = await PostfachZustaendigMehrereRoute(
    request('PUT', '/kontakt/zustaendig-mehrere', KONTAKT, {
      login: 'tom@stamm-phoenix.de',
      konversationen: [
        { konversation: K1, vorher: null },
        { konversation: K2, vorher: null },
        { konversation: K2, vorher: null },
      ],
    }),
    context
  );
  assert.equal(response.status, 200);
  const body = response.jsonBody as {
    ergebnisse: {
      konversation: string;
      ok: boolean;
      fehler?: string;
      status?: string;
      zustaendig: { login: string } | null;
    }[];
    benachrichtigt: boolean;
  };
  assert.deepEqual(
    body.ergebnisse.map((ergebnis) => [
      ergebnis.konversation,
      ergebnis.ok,
      ergebnis.zustaendig?.login,
      ergebnis.status,
    ]),
    [
      [K1, false, 'lea@stamm-phoenix.de', undefined],
      [K2, true, 'tom@stamm-phoenix.de', 'handlungsbedarf'],
    ]
  );
  assert.match(body.ergebnisse[0].fehler ?? '', /Lea Leitung/);
  assert.equal(body.benachrichtigt, true);
  // One note for Tom, with the conversation that was assigned
  const toTom = mocks.mails.filter((mail) => mail[0] === 'tom@stamm-phoenix.de');
  assert.equal(toTom.length, 1);
  assert.deepEqual(
    (toTom[0][2] as { id: string }[]).map((zeile) => zeile.id),
    [K2]
  );

  const leer = await PostfachZustaendigMehrereRoute(
    request('PUT', '/kontakt/zustaendig-mehrere', KONTAKT, { login: null, konversationen: [] }),
    context
  );
  assert.equal(leer.status, 400);
});

test('an unexpected failure of one conversation keeps those saved before and after', async (t) => {
  const { context, mocks } = setup(t);
  const K3 = 'AAQkAGkonversation3333333333=';
  const gelesen = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (query?.$filter?.includes(K3)) throw new Error('Graph antwortet nicht');
      return gelesen(path, query, prefer);
    }
  );
  const response = await PostfachZustaendigMehrereRoute(
    request('PUT', '/kontakt/zustaendig-mehrere', KONTAKT, {
      login: 'tom@stamm-phoenix.de',
      konversationen: [
        { konversation: K2, vorher: null },
        { konversation: K3, vorher: null },
        { konversation: K1, vorher: null },
      ],
    }),
    context
  );
  assert.equal(response.status, 200);
  const body = response.jsonBody as {
    ergebnisse: { konversation: string; ok: boolean; zustaendig?: { login: string } | null }[];
    benachrichtigt: boolean;
  };
  assert.deepEqual(
    body.ergebnisse.map((ergebnis) => [ergebnis.konversation, ergebnis.ok]),
    [
      [K2, true],
      [K3, false],
      [K1, true],
    ]
  );
  // What applies to K3 is unknown, so the page does not guess
  assert.equal('zustaendig' in body.ergebnisse[1], false);
  assert.equal(body.benachrichtigt, true);
  assert.deepEqual(
    (mocks.mails[0][2] as { id: string }[]).map((zeile) => zeile.id),
    [K2, K1]
  );
});

test('handing a choice to the person who already has it sends no note and reports none due', async (t) => {
  const { context, mocks } = setup(t);
  const anTom = (vorher: string | null) =>
    PostfachZustaendigMehrereRoute(
      request('PUT', '/kontakt/zustaendig-mehrere', KONTAKT, {
        login: 'tom@stamm-phoenix.de',
        konversationen: [{ konversation: K2, vorher }],
      }),
      context
    );
  assert.equal((await anTom(null)).jsonBody?.benachrichtigt, true);
  const nochmal = await anTom('Tom Test');
  assert.equal(nochmal.status, 200);
  assert.equal(nochmal.jsonBody?.benachrichtigt, null);
  assert.equal(mocks.mails.length, 1);
});

test('without permission to change the mailbox nothing is saved and the page says whom to tell', async (t) => {
  const { context, mocks } = setup(t);
  t.mock.method(postfachGraph, 'patch', async () => {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  });
  const einzeln = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: 'tom@stamm-phoenix.de',
    }),
    context
  );
  assert.equal(einzeln.status, 503);
  assert.match((einzeln.jsonBody as { message: string }).message, /admin@stamm-phoenix.de/);
  const mehrere = await PostfachZustaendigMehrereRoute(
    request('PUT', '/kontakt/zustaendig-mehrere', KONTAKT, {
      login: 'tom@stamm-phoenix.de',
      konversationen: [{ konversation: K2, vorher: null }],
    }),
    context
  );
  assert.equal(mehrere.status, 503);
  assert.equal(mocks.mails.length, 0);
});

test('a preview reads the real mailbox but changes nothing in it', async (t) => {
  const { context, mocks } = setup(t);
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  const response = await PostfachZustaendigRoute(
    request('PUT', '/kontakt/zustaendig', KONTAKT, {
      konversation: K2,
      login: 'tom@stamm-phoenix.de',
    }),
    context
  );
  assert.equal(response.status, 403);
  assert.equal(mocks.patches.length, 0);
});
