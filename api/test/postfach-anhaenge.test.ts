import assert from 'node:assert/strict';
import { PostfachKonversationRoute } from '../endpoints/intern-postfach';
import { postfachGraph } from '../lib/postfach-graph';
import type { KonversationDetail } from '../lib/postfach-model';
import { dbTest } from './fixtures/database';
import { K2, KONTAKT, message, request, setup } from './fixtures/postfach';

dbTest('attachments on later pages are read too, files and inline images alike', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  const base =
    'https://graph.microsoft.com/v1.0/users/kontakt%40stamm-phoenix.de/messages/AAkALgm3000000/attachments';
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/messages') && query.$filter?.includes(K2)) {
        return {
          value: [
            message('AAkALgm3000000', K2, 2, {
              hasAttachments: true,
              body: { contentType: 'html', content: '<img src="cid:spaet">' },
              parentFolderId: 'FOLDER-INBOX',
            }),
          ],
        };
      }
      if (path.endsWith('/attachments')) {
        return {
          value: [
            {
              id: 'AAMkerste0001',
              name: 'Erste.pdf',
              contentType: 'application/pdf',
              size: 9,
              isInline: false,
            },
          ],
          '@odata.nextLink': `${base}?$skiptoken=2`,
        };
      }
      if (path.endsWith('/attachments/AAMkspaet0001'))
        return {
          name: 'spaet.png',
          contentType: 'image/png',
          contentId: 'spaet',
          contentBytes: 'CCCC',
          size: 4,
        };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const pages: string[] = [];
  t.mock.method(postfachGraph, 'next', async (url: string) => {
    pages.push(url);
    return {
      value: [
        {
          id: 'AAMkzweite001',
          name: 'Zweite.pdf',
          contentType: 'application/pdf',
          size: 9,
          isInline: false,
        },
        {
          id: 'AAMkspaet0001',
          name: 'spaet.png',
          contentType: 'image/png',
          size: 4,
          isInline: true,
        },
      ],
    };
  });
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  );
  const [nachricht] = (response.jsonBody as KonversationDetail).nachrichten;
  assert.deepEqual(pages, [`${base}?$skiptoken=2`]);
  assert.deepEqual(
    nachricht.anhaenge.map((anhang) => anhang.name),
    ['Erste.pdf', 'Zweite.pdf']
  );
  assert.equal(nachricht.html, '<img src="data:image/png;base64,CCCC">');
});

dbTest('a continuation of the attachments that leaves Graph is refused', async (t) => {
  const { context } = setup(t);
  const original = postfachGraph.get;
  t.mock.method(
    postfachGraph,
    'get',
    async (path: string, query: Record<string, string>, prefer: string[]) => {
      if (path.endsWith('/attachments'))
        return { value: [], '@odata.nextLink': 'https://evil.example/v1.0/x/attachments' };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const next = t.mock.method(postfachGraph, 'next', async () => ({ value: [] }));
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  ).catch((error: unknown) => error);
  assert.equal(next.mock.callCount(), 0);
  assert.ok(response instanceof Error || (response as { status?: number }).status === 500);
});

dbTest('an inline image too large to embed stays reachable as an attachment', async (t) => {
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
              body: { contentType: 'html', content: '<img src="cid:klein"><img src="cid:gross">' },
              parentFolderId: 'FOLDER-INBOX',
            }),
          ],
        };
      }
      if (path.endsWith('/attachments')) {
        return {
          value: [
            {
              id: 'AAMkklein0001',
              name: 'klein.png',
              contentType: 'image/png',
              size: 4,
              isInline: true,
            },
            {
              id: 'AAMkgross0001',
              name: 'Einladung.png',
              contentType: 'image/png',
              size: 2_000_000,
              isInline: true,
            },
          ],
        };
      }
      if (path.endsWith('/attachments/AAMkklein0001'))
        return {
          name: 'klein.png',
          contentType: 'image/png',
          contentId: 'klein',
          contentBytes: 'DDDD',
          size: 4,
        };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  );
  const [nachricht] = (response.jsonBody as KonversationDetail).nachrichten;
  assert.match(nachricht.html ?? '', /data:image\/png;base64,DDDD/);
  assert.deepEqual(
    nachricht.anhaenge.map((anhang) => [anhang.name, anhang.herunterladbar]),
    [['Einladung.png', true]]
  );
});

dbTest('an inline image written with CID: in capitals is embedded too', async (t) => {
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
              hasAttachments: false,
              body: { contentType: 'html', content: '<img src="CID:einladung">' },
              parentFolderId: 'FOLDER-INBOX',
            }),
          ],
        };
      }
      if (path.endsWith('/attachments')) {
        return {
          value: [
            {
              id: 'AAMkeinlad001',
              name: 'einladung.png',
              contentType: 'image/png',
              size: 4,
              isInline: true,
            },
          ],
        };
      }
      if (path.endsWith('/attachments/AAMkeinlad001'))
        return {
          name: 'einladung.png',
          contentType: 'image/png',
          contentId: 'einladung',
          contentBytes: 'EEEE',
          size: 4,
        };
      return original.call(postfachGraph, path, query, prefer);
    }
  );
  const response = await PostfachKonversationRoute(
    request('GET', `/kontakt/konversation?id=${encodeURIComponent(K2)}`, KONTAKT),
    context
  );
  const [nachricht] = (response.jsonBody as KonversationDetail).nachrichten;
  assert.equal(nachricht.html, '<img src="data:image/png;base64,EEEE">');
  assert.deepEqual(nachricht.anhaenge, []);
});
