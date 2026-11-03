import assert from 'node:assert/strict';
import {
  PostfachGelesenRoute,
  PostfachPersonenRoute,
  PostfachStartRoute,
  PostfachZustaendigRoute,
} from '../endpoints/intern-postfach';
import { postfachVerzeichnis } from '../lib/postfach';
import { postfachGraph } from '../lib/postfach-graph-basis';
import type { PostfachStart } from '../lib/postfach-model';
import { getDb } from '../lib/db';
import { CONFIG } from '../lib/config';
import { PostfachZustaendigMehrereRoute } from '../endpoints/intern-postfach-mehrere';
import { dbTest } from './fixtures/database';
import { K1, K2, KONTAKT, LEA, request, setup, TOM } from './fixtures/postfach';

dbTest(
  'assigning a conversation notifies the person and shows it on their start page',
  async (t) => {
    const { context, mocks } = setup(t);
    const response = await PostfachZustaendigRoute(
      request('PUT', '/kontakt/zustaendig', KONTAKT, {
        konversation: K2,
        login: 'tom@stamm-phoenix.de',
        vorher: null,
      }),
      context
    );
    assert.equal(response.status, 200);
    const body = response.jsonBody as {
      zustaendig: { login: string; vonName: string };
      benachrichtigt: boolean;
    };
    assert.equal(body.zustaendig.login, 'tom@stamm-phoenix.de');
    assert.equal(body.zustaendig.vonName, 'Lea Leitung');
    assert.equal(body.benachrichtigt, true);
    assert.equal(mocks.mails.length, 1);
    assert.equal(mocks.mails[0][0], 'tom@stamm-phoenix.de');

    await PostfachGelesenRoute(
      request('POST', '/kontakt/gelesen', KONTAKT, { alle: true }, TOM),
      context
    );
    const start = (await PostfachStartRoute(request('GET', '', {}, undefined, TOM), context))
      .jsonBody as PostfachStart;
    assert.deepEqual(
      start.fuerMich.map((zeile) => zeile.id),
      [K2]
    );
    assert.deepEqual(
      start.postfaecher.map((postfach) => [
        postfach.id,
        postfach.ungelesen,
        postfach.mirZugewiesen,
        postfach.fehler,
      ]),
      [['kontakt', 0, 1, false]]
    );

    // Taking it over oneself sends no note; a stale page gets a conflict naming the current person
    const self = await PostfachZustaendigRoute(
      request('PUT', '/kontakt/zustaendig', KONTAKT, {
        konversation: K2,
        login: 'lea@stamm-phoenix.de',
        vorher: 'tom@stamm-phoenix.de',
      }),
      context
    );
    assert.equal(self.status, 200);
    assert.equal(mocks.mails.length, 1);
    const stale = await PostfachZustaendigRoute(
      request(
        'PUT',
        '/kontakt/zustaendig',
        KONTAKT,
        { konversation: K2, login: null, vorher: 'tom@stamm-phoenix.de' },
        TOM
      ),
      context
    );
    assert.equal(stale.status, 409);
    assert.match(
      (stale.jsonBody as { message: string }).message,
      /Lea Leitung ist jetzt zuständig/
    );
    const row = await getDb()
      .selectFrom('postfach.zustaendigkeit')
      .selectAll()
      .executeTakeFirstOrThrow();
    assert.equal(row.login, 'lea@stamm-phoenix.de');
  }
);

dbTest('only members of the teams can be made responsible', async (t) => {
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

dbTest(
  'only members who are also Leitende can be made responsible for a team mailbox',
  async (t) => {
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
    const ohneTeam = await PostfachPersonenRoute(
      request('GET', '/verein/personen', params),
      context
    );
    assert.equal(ohneTeam.status, 403);
  }
);

dbTest(
  'several conversations are assigned at once with one note, a stale one stays as it is',
  async (t) => {
    const { context, mocks } = setup(t);
    // K1 was taken by Lea meanwhile; the page still shows nobody
    await PostfachZustaendigRoute(
      request('PUT', '/kontakt/zustaendig', KONTAKT, {
        konversation: K1,
        login: 'lea@stamm-phoenix.de',
      }),
      context
    );
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
        zustaendig: { login: string } | null;
      }[];
      benachrichtigt: boolean;
    };
    assert.deepEqual(
      body.ergebnisse.map((ergebnis) => [
        ergebnis.konversation,
        ergebnis.ok,
        ergebnis.zustaendig?.login,
      ]),
      [
        [K1, false, 'lea@stamm-phoenix.de'],
        [K2, true, 'tom@stamm-phoenix.de'],
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
  }
);

dbTest(
  'an unexpected failure of one conversation keeps those saved before and after',
  async (t) => {
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
  }
);

dbTest(
  'handing a choice to the person who already has it sends no note and reports none due',
  async (t) => {
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
    const nochmal = await anTom('tom@stamm-phoenix.de');
    assert.equal(nochmal.status, 200);
    assert.equal(nochmal.jsonBody?.benachrichtigt, null);
    assert.equal(mocks.mails.length, 1);
  }
);
