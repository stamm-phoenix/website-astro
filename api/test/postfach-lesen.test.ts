import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostfachAnhangRoute, PostfachKonversationRoute } from '../endpoints/intern-postfach';
import { postfachGraph } from '../lib/postfach-graph';
import type { KonversationDetail } from '../lib/postfach-model';
import { K1, K2, KONTAKT, message, request, setup } from './fixtures/postfach';

test('the reading view embeds inline images, lists attachments and links to Outlook', async (t) => {
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
  assert.equal(detail.nachrichten[1].text, 'Danke!');
  // The form note comes from the mailbox's own address, but it was received
  assert.equal(detail.nachrichten[2].gesendet, false);
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
    request(
      'GET',
      `/kontakt/konversation?id=${encodeURIComponent('AAQkAGkonversation9999999999=')}`,
      KONTAKT
    ),
    context
  );
  assert.equal(fehlt.status, 404);
});

test('attachments download with a harmless type', async (t) => {
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

test('long conversations are read page by page and say when Outlook has more', async (t) => {
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

test('attached messages and large files are only offered in Outlook', async (t) => {
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

test('inline images with ids that start alike each get their own picture', async (t) => {
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
