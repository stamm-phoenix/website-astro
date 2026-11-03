import assert from 'node:assert/strict';
import {
  PostfachGelesenRoute,
  PostfachPersonenRoute,
  PostfachStartRoute,
  PostfachZustaendigRoute,
} from '../endpoints/intern-postfach';
import { postfachVerzeichnis } from '../lib/postfach';
import type { PostfachStart } from '../lib/postfach-model';
import { getDb } from '../lib/db';
import { CONFIG } from '../lib/config';
import { dbTest } from './fixtures/database';
import { K2, KONTAKT, LEA, request, setup, TOM } from './fixtures/postfach';

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
