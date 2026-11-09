import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { postfachGraph } from '../../lib/postfach-graph-basis';
import { postfachVerzeichnis, resetPostfachCaches } from '../../lib/postfach';
import { postfachBenachrichtigung } from '../../lib/postfach-mails';

/** Shared setup of the tests of the module „E-Mail“: logins, demo messages and Graph mocks. */

export const LEA = {
  identityProvider: 'aad',
  userId: 'user-lea',
  userDetails: 'Lea@stamm-phoenix.de',
  userRoles: ['authenticated', 'team_leitende'],
};
export const TOM = { ...LEA, userId: 'user-tom', userDetails: 'tom@stamm-phoenix.de' };

export const K1 = 'AAQkAGkonversation1111111111=';
export const K2 = 'AAQkAGkonversation2222222222=';
export const NOW = Date.now();
export const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * 3_600_000).toISOString();

export function message(
  id: string,
  conversationId: string,
  hoursAgo: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
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
    '@odata.etag': `W/"${id}-1"`,
    ...extra,
  };
}

const KONTAKT_ADRESSE = { emailAddress: { name: 'Kontakt', address: 'kontakt@stamm-phoenix.de' } };

/** The messages of the demo mailbox in every folder, as Graph gives them. */
export function demoPostfach(): Record<string, unknown>[] {
  return [
    message('AAkALgm1000000', K1, 1, { parentFolderId: 'FOLDER-INBOX' }),
    message('AAkALgm2000000', K1, 30 * 24, { parentFolderId: 'FOLDER-INBOX' }),
    message('AAkALgm3000000', K2, 2, {
      hasAttachments: true,
      toRecipients: [KONTAKT_ADRESSE],
      body: { contentType: 'html', content: '<p>Hallo <img src="cid:bild1"></p>' },
      parentFolderId: 'FOLDER-INBOX',
    }),
    message('AAkALgm4000000', K2, 1, {
      from: KONTAKT_ADRESSE,
      body: { contentType: 'text', content: 'Danke!' },
      parentFolderId: 'FOLDER-SENT',
    }),
    // A note of the contact form: sent by the mailbox to itself, received in the inbox
    message('AAkALgm5000000', K2, 0.5, {
      from: KONTAKT_ADRESSE,
      body: { contentType: 'text', content: 'Neue Nachricht über das Kontaktformular' },
      parentFolderId: 'FOLDER-INBOX',
    }),
  ];
}

export interface Mocks {
  mails: unknown[][];
  graph: string[];
  /** The messages of the mailbox; changes through Graph land here. */
  postfach: Record<string, unknown>[];
  /** The changes sent to Graph, by message ID. */
  patches: { id: string; body: Record<string, unknown> }[];
  /** Categories in the mailbox's list. */
  kategorien: string[];
}

/** A message of the list, without what only the reading view asks for. */
function ohneDetails(entry: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...entry };
  delete rest.body;
  return rest;
}

export function setup(t: TestContext): { context: InvocationContext; mocks: Mocks } {
  resetPostfachCaches();
  const context = new InvocationContext({ functionName: 'postfach-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  const mocks: Mocks = {
    mails: [],
    graph: [],
    postfach: demoPostfach(),
    patches: [],
    kategorien: [],
  };
  t.mock.method(postfachGraph, 'get', async (path: string, query: Record<string, string>) => {
    mocks.graph.push(path);
    if (path.endsWith('/mailFolders/inbox/messages'))
      return {
        value: mocks.postfach
          .filter((entry) => entry.parentFolderId === 'FOLDER-INBOX')
          .sort((a, b) => String(b.receivedDateTime).localeCompare(String(a.receivedDateTime)))
          .map(ohneDetails),
      };
    if (path.endsWith('/mailFolders/sentitems')) return { id: 'FOLDER-SENT' };
    if (path.endsWith('/mailFolders/inbox')) return { id: 'FOLDER-INBOX' };
    if (path.endsWith('/outlook/masterCategories'))
      return { value: mocks.kategorien.map((displayName) => ({ displayName })) };
    if (path.endsWith('/messages') && query.$filter?.startsWith('receivedDateTime ge ')) {
      const ab = query.$filter.slice('receivedDateTime ge '.length);
      return {
        value: mocks.postfach
          .filter((entry) => String(entry.receivedDateTime) >= ab)
          .map(ohneDetails),
      };
    }
    if (path.endsWith('/messages')) {
      const id = /conversationId eq '([^']*)'/.exec(query.$filter ?? '')?.[1];
      // Copies, as Graph answers: a later change of the mailbox does not reach what was read
      return {
        value: mocks.postfach
          .filter((entry) => entry.conversationId === id)
          .map((entry) => structuredClone(entry)),
      };
    }
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
  t.mock.method(postfachGraph, 'post', async (path: string, body: { displayName?: string }) => {
    if (path.endsWith('/outlook/masterCategories')) {
      mocks.kategorien.push(body.displayName ?? '');
      return {};
    }
    return { value: [{ targetId: 'AAMkrest' }] };
  });
  t.mock.method(
    postfachGraph,
    'patch',
    async (path: string, body: Record<string, unknown>, etag?: string) => {
      const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
      const entry = mocks.postfach.find((candidate) => candidate.id === id);
      if (!entry) throw Object.assign(new Error('not found'), { statusCode: 404 });
      // As Exchange: a change of another version is refused
      if (etag && etag !== entry['@odata.etag'])
        throw Object.assign(new Error('precondition failed'), { statusCode: 412 });
      mocks.patches.push({ id, body });
      Object.assign(entry, body, { '@odata.etag': `W/"${id}-${mocks.patches.length + 1}"` });
      return entry;
    }
  );
  t.mock.method(postfachVerzeichnis, 'lesen', async () => [
    { login: 'lea@stamm-phoenix.de', name: 'Lea Leitung', givenName: 'Lea' },
    { login: 'tom@stamm-phoenix.de', name: 'Tom Test', givenName: 'Tom' },
  ]);
  t.mock.method(postfachBenachrichtigung, 'senden', async (...args: unknown[]) => {
    mocks.mails.push(args);
  });
  return { context, mocks };
}

export function request(
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

export const KONTAKT = { postfach: 'kontakt' };
