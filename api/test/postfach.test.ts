import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  PostfachAnhangRoute,
  PostfachGelesenRoute,
  PostfachKonversationRoute,
  PostfachListeRoute,
  PostfachPersonenRoute,
  PostfachStartRoute,
  PostfachZustaendigRoute,
} from '../endpoints/intern-postfach';
import { PostfachStatusRoute } from '../endpoints/intern-postfach-status';
import { postfachGraph } from '../lib/postfach-graph';
import { postfachVerzeichnis, resetPostfachCaches } from '../lib/postfach';
import { postfachBenachrichtigung } from '../lib/postfach-mails';
import type { KonversationDetail, PostfachAnsicht, PostfachStart } from '../lib/postfach-model';
import { getDb } from '../lib/db';
import { CONFIG } from '../lib/config';
import { dbTest } from './fixtures/database';

const LEA = {
  identityProvider: 'aad',
  userId: 'user-lea',
  userDetails: 'Lea@stamm-phoenix.de',
  userRoles: ['authenticated', 'team_leitende'],
};
const TOM = { ...LEA, userId: 'user-tom', userDetails: 'tom@stamm-phoenix.de' };

const K1 = 'AAQkAGkonversation1111111111=';
const K2 = 'AAQkAGkonversation2222222222=';
const NOW = Date.now();
const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * 3_600_000).toISOString();

function message(id: string, conversationId: string, hoursAgo: number, extra: object = {}): object {
  return {
    id,
    conversationId,
    subject: `Betreff ${id}`,
    from: { emailAddress: { name: 'Erika Muster', address: 'erika@example.invalid' } },
    receivedDateTime: iso(hoursAgo),
    bodyPreview: `Vorschau ${id}`,
    hasAttachments: false,
    importance: 'normal',
    isDraft: false,
    ...extra,
  };
}

const INBOX = [
  message('AAkALgm1000000', K1, 1),
  message('AAkALgm2000000', K1, 30 * 24),
  message('AAkALgm3000000', K2, 2, { hasAttachments: true }),
];

interface Mocks {
  mails: unknown[][];
  graph: string[];
}

function setup(t: TestContext): { context: InvocationContext; mocks: Mocks } {
  resetPostfachCaches();
  const context = new InvocationContext({ functionName: 'postfach-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  const mocks: Mocks = { mails: [], graph: [] };
  t.mock.method(postfachGraph, 'get', async (path: string, query: Record<string, string>) => {
    mocks.graph.push(path);
    if (path.endsWith('/mailFolders/inbox/messages')) return { value: INBOX };
    if (path.endsWith('/mailFolders/sentitems')) return { id: 'FOLDER-SENT' };
    if (path.endsWith('/mailFolders/inbox')) return { id: 'FOLDER-INBOX' };
    if (path.endsWith('/messages') && query.$filter?.includes(K2)) {
      return {
        value: [
          message('AAkALgm3000000', K2, 2, {
            hasAttachments: true,
            toRecipients: [
              { emailAddress: { name: 'Kontakt', address: 'kontakt@stamm-phoenix.de' } },
            ],
            body: { contentType: 'html', content: '<p>Hallo <img src="cid:bild1"></p>' },
            parentFolderId: 'FOLDER-INBOX',
          }),
          message('AAkALgm4000000', K2, 1, {
            from: { emailAddress: { name: 'Kontakt', address: 'kontakt@stamm-phoenix.de' } },
            body: { contentType: 'text', content: 'Danke!' },
            parentFolderId: 'FOLDER-SENT',
          }),
          // A note of the contact form: sent by the mailbox to itself, received in the inbox
          message('AAkALgm5000000', K2, 0.5, {
            from: { emailAddress: { name: 'Kontakt', address: 'kontakt@stamm-phoenix.de' } },
            body: { contentType: 'text', content: 'Neue Nachricht über das Kontaktformular' },
            parentFolderId: 'FOLDER-INBOX',
          }),
        ],
      };
    }
    if (path.endsWith('/messages')) return { value: [] };
    if (path.endsWith('/attachments')) {
      return {
        value: [
          {
            id: 'AAMkinline0001',
            name: 'bild.png',
            contentType: 'image/png',
            size: 10,
            isInline: true,
          },
          {
            id: 'AAMkdatei00001',
            name: 'Plan.pdf',
            contentType: 'application/pdf',
            size: 99,
            isInline: false,
          },
        ],
      };
    }
    if (path.endsWith('/attachments/AAMkinline0001')) {
      return {
        name: 'bild.png',
        contentType: 'image/png',
        contentId: '<bild1>',
        contentBytes: 'iVBO',
        size: 10,
      };
    }
    if (path.endsWith('/attachments/AAMkdatei00001')) {
      return {
        id: 'AAMkdatei00001',
        name: 'Plan.pdf',
        contentType: query.$select ? 'application/pdf' : 'text/html',
        size: 3,
        isInline: false,
        contentBytes: Buffer.from('pdf').toString('base64'),
      };
    }
    throw Object.assign(new Error('unexpected'), { statusCode: 404 });
  });
  t.mock.method(postfachGraph, 'post', async () => ({ value: [{ targetId: 'AAMkrest' }] }));
  t.mock.method(postfachVerzeichnis, 'lesen', async () => [
    { login: 'lea@stamm-phoenix.de', name: 'Lea Leitung', givenName: 'Lea' },
    { login: 'tom@stamm-phoenix.de', name: 'Tom Test', givenName: 'Tom' },
  ]);
  t.mock.method(postfachBenachrichtigung, 'senden', async (...args: unknown[]) => {
    mocks.mails.push(args);
  });
  return { context, mocks };
}

function request(
  method: string,
  url: string,
  params: Record<string, string>,
  body?: unknown,
  principal: unknown = LEA
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (principal)
    headers['x-ms-client-principal'] = Buffer.from(JSON.stringify(principal)).toString('base64');
  return new HttpRequest({
    url: `http://localhost/api/intern/postfach${url}`,
    method,
    headers,
    params,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

const KONTAKT = { postfach: 'kontakt' };

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
  'the reading view embeds inline images, lists attachments and links to Outlook',
  async (t) => {
    const { context } = setup(t);
    const response = await PostfachKonversationRoute(
      request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
      context
    );
    assert.equal(response.status, 200);
    const detail = response.jsonBody as KonversationDetail;
    assert.equal(detail.nachrichten.length, 3);
    assert.match(detail.nachrichten[0].html ?? '', /src="data:image\/png;base64,iVBO"/);
    assert.deepEqual(
      detail.nachrichten[0].anhaenge.map((anhang) => anhang.name),
      ['Plan.pdf']
    );
    assert.equal(detail.nachrichten[1].gesendet, true);
    assert.equal(detail.nachrichten[1].gelesen, true);
    assert.equal(detail.nachrichten[1].text, 'Danke!');
    // The form note comes from the mailbox's own address, but it was received: it is to be read
    assert.equal(detail.nachrichten[2].gesendet, false);
    assert.equal(detail.nachrichten[2].gelesen, false);
    assert.deepEqual(
      detail.nachrichten.map((nachricht) => nachricht.imPosteingang),
      [true, false, true]
    );
    // The line takes the newest received message, here the form note
    assert.equal(detail.konversation.betreff, 'Betreff AAkALgm5000000');
    assert.equal(
      detail.outlookUrl,
      'https://outlook.office.com/mail/kontakt%40stamm-phoenix.de/inbox/id/AAMkrest'
    );

    const fehlt = await PostfachKonversationRoute(
      request('GET', `/kontakt/konversation?id=${encodeURIComponent(K1)}`, KONTAKT),
      context
    );
    assert.equal(fehlt.status, 404);
  }
);

dbTest('attachments download with a harmless type', async (t) => {
  const { context } = setup(t);
  const response = await PostfachAnhangRoute(
    request('GET', '/kontakt/anhang?nachricht=AAkALgm3000000&anhang=AAMkdatei00001', KONTAKT),
    context
  );
  assert.equal(response.status, 200);
  const headers = response.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.match(headers['Content-Disposition'], /attachment/);
  assert.equal(Buffer.from(response.body as Uint8Array).toString(), 'pdf');
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

dbTest('long conversations are read page by page and say when Outlook has more', async (t) => {
  const { context } = setup(t);
  const page = (id: string, hoursAgo: number, next?: string): object => ({
    value: [message(id, K1, hoursAgo, { body: { contentType: 'text', content: id } })],
    ...(next ? { '@odata.nextLink': next } : {}),
  });
  const base = 'https://graph.microsoft.com/v1.0/users/kontakt%40stamm-phoenix.de/messages';
  t.mock.method(postfachGraph, 'get', async (path: string) => {
    if (path.endsWith('/messages')) return page('AAkALgp0000001', 5, `${base}?$skip=50`);
    throw Object.assign(new Error('unexpected'), { statusCode: 404 });
  });
  const pages: string[] = [];
  t.mock.method(postfachGraph, 'next', async (url: string) => {
    pages.push(url);
    return page(
      `AAkALgp000000${pages.length + 1}`,
      5 - pages.length,
      `${base}?$skip=${50 * (pages.length + 1)}`
    );
  });
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K1)}`, KONTAKT),
    context
  );
  const detail = response.jsonBody as KonversationDetail;
  assert.equal(pages.length, 3);
  assert.equal(detail.nachrichten.length, 4);
  assert.equal(detail.vollstaendig, false);

  t.mock.method(postfachGraph, 'next', async () =>
    page('AAkALgp0000009', 1, 'https://evil.example/users/x/messages')
  );
  const fremd = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K1)}`, KONTAKT),
    context
  ).catch((error: unknown) => error);
  assert.ok(fremd instanceof Error || (fremd as { status?: number }).status === 500);
});

dbTest('attached messages and large files are only offered in Outlook', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/attachments')) {
        return {
          value: [
            {
              '@odata.type': '#microsoft.graph.itemAttachment',
              id: 'AAMkitem00001',
              name: 'Weitergeleitet',
              contentType: '',
              size: 10,
              isInline: false,
            },
            {
              id: 'AAMkgross0001',
              name: 'Video.mp4',
              contentType: 'video/mp4',
              size: 30_000_000,
              isInline: false,
            },
            {
              id: 'AAMkdatei00001',
              name: 'Plan.pdf',
              contentType: 'application/pdf',
              size: 99,
              isInline: false,
            },
          ],
        };
      }
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  );
  const detail = response.jsonBody as KonversationDetail;
  assert.equal(detail.vollstaendig, true);
  assert.deepEqual(
    detail.nachrichten[0].anhaenge.map((anhang) => [anhang.name, anhang.herunterladbar]),
    [
      ['Weitergeleitet', false],
      ['Video.mp4', false],
      ['Plan.pdf', true],
    ]
  );
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
        { konversation: K2, status: 'erledigt', vorher: 'offen', bis: iso(2) },
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
        bis: iso(2),
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
        bis: iso(2),
      }),
      context
    );
    assert.equal(reopen.status, 200);
    const back = await PostfachStatusRoute(
      request('PUT', '/kontakt/status', KONTAKT, {
        konversation: K2,
        status: 'offen',
        vorher: 'kein_handlungsbedarf',
        bis: iso(2),
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

dbTest('inline images with ids that start alike each get their own picture', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/messages') && query.$filter?.includes(K2)) {
        return {
          value: [
            message('AAkALgm3000000', K2, 2, {
              body: {
                contentType: 'html',
                content: '<img src="cid:image1"><img src="cid:image10">',
              },
              parentFolderId: 'FOLDER-INBOX',
            }),
          ],
        };
      }
      if (path.endsWith('/attachments')) {
        return {
          value: [
            {
              id: 'AAMkbild00001',
              name: 'a.png',
              contentType: 'image/png',
              size: 4,
              isInline: true,
            },
            {
              id: 'AAMkbild00010',
              name: 'b.png',
              contentType: 'image/png',
              size: 4,
              isInline: true,
            },
          ],
        };
      }
      if (path.endsWith('/attachments/AAMkbild00001'))
        return {
          name: 'a.png',
          contentType: 'image/png',
          contentId: 'image1',
          contentBytes: 'AAAA',
          size: 4,
        };
      if (path.endsWith('/attachments/AAMkbild00010'))
        return {
          name: 'b.png',
          contentType: 'image/png',
          contentId: 'image10',
          contentBytes: 'BBBB',
          size: 4,
        };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  );
  const html = (response.jsonBody as KonversationDetail).nachrichten[0].html ?? '';
  assert.equal(
    html,
    '<img src="data:image/png;base64,AAAA"><img src="data:image/png;base64,BBBB">'
  );
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
