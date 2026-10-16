import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EditorCollection,
  EditorItem,
  EditorReview,
  EditorSperre,
  EditorVersand,
  GetEditorPdf,
  GetEditorProtokoll,
} from '../endpoints/intern-protokoll-editor';
import * as campflow from '../lib/campflow';
import { CONFIG } from '../lib/config';
import * as leitendeList from '../lib/leitende-list';
import * as mail from '../lib/mail';
import { editorAblageItemIds } from '../lib/protokoll-editor';
import type { ProtokollEditorDetail } from '../lib/protokoll-editor-model';
import { neuerInhalt } from '../lib/protokoll-editor-model';
import {
  createProtokollPdf,
  protokollPdfDefinition,
  protokollPdfFileName,
} from '../lib/protokoll-editor-pdf';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as taskDirectory from '../lib/task-directory';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.reviewer@stamm-phoenix.de';
const CARL = 'carl.leiter@stamm-phoenix.de';
const TOKEN_A = 'tab-a-0123456789abcdef';
const TOKEN_B = 'tab-b-0123456789abcdef';
const TOKEN_C = 'tab-c-0123456789abcdef';
const SENDER = 'protokolle@stamm-phoenix.de';

function request(
  login: string,
  method: string,
  params: Record<string, string> = {},
  body?: unknown
): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated'],
  };
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/protokoll-editor',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'protokoll-editor-review-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'warn', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

interface Uploaded {
  folder: string;
  name: string;
  content: Uint8Array;
}

/** Sender, directory and SharePoint without Graph; records uploads. */
function setup(t: TestContext) {
  overrideConfig(t, CONFIG.protokolle, { sender: SENDER });
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: ANNA, name: 'Anna Autorin', givenName: 'Anna' },
  ]);
  t.mock.method(leitendeList, 'getLeitende', async () => [
    {
      id: '1',
      name: 'Vera Vorstand',
      teams: ['Vorstand'],
      telephone: '0151 000000',
      hasImage: false,
    },
  ]);
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  const uploads: Uploaded[] = [];
  const files = new Map<string, Uint8Array>();
  const upload = t.mock.method(
    sharePoint,
    'createSharePointDriveFile',
    async (_drive: string, folder: string, name: string, content: Uint8Array) => {
      uploads.push({ folder, name, content });
      const id = `item-${uploads.length}`;
      files.set(id, content);
      return { id, name, webUrl: `https://sharepoint.test/${encodeURIComponent(name)}` };
    }
  );
  const removed = t.mock.method(
    sharePoint,
    'deleteSharePointDriveItem',
    async (_drive: string, id: string) => {
      files.delete(id);
    }
  );
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async (_d: string, id: string) => {
    const file = files.get(id);
    if (!file) throw Object.assign(new Error('missing'), { statusCode: 404 });
    return file;
  });
  return { uploads, upload, removed, files };
}

async function create(t: TestContext, context: InvocationContext): Promise<number> {
  const created = await EditorCollection(
    request(ANNA, 'POST', {}, { title: 'Leitendenrunde', date: '2026-10-14' }),
    context
  );
  assert.equal(created.status, 201);
  return (created.jsonBody as { id: number }).id;
}

async function load(login: string, id: number): Promise<ProtokollEditorDetail> {
  const loaded = await GetEditorProtokoll(
    request(login, 'GET', { id: String(id) }),
    new InvocationContext({ functionName: 'protokoll-editor-review-test' })
  );
  assert.equal(loaded.status, 200);
  return loaded.jsonBody as ProtokollEditorDetail;
}

function review(login: string, id: number, body: Record<string, unknown>) {
  return request(login, 'POST', { id: String(id) }, body);
}

/** Anna writes, gives the minutes to the review; returns the minutes in review. */
async function inReview(t: TestContext, context: InvocationContext) {
  const id = await create(t, context);
  const sperre = await EditorSperre(
    request(ANNA, 'POST', { id: String(id) }, { token: TOKEN_A }),
    context
  );
  assert.equal(sperre.status, 200);
  const draft = await load(ANNA, id);
  const submitted = await EditorReview(
    review(ANNA, id, { action: 'review', etag: draft.etag, token: TOKEN_A }),
    context
  );
  assert.equal(submitted.status, 200);
  return { id, draft, detail: await load(BEN, id) };
}

dbTest('minutes go to the review, the writing tab stops and the lock is gone', async (t) => {
  setup(t);
  const context = quietContext(t);
  const { id, draft, detail } = await inReview(t, context);
  assert.equal(detail.status, 'review');
  assert.equal(detail.submittedBy, ANNA);
  assert.equal(detail.sperre, null);
  assert.equal(detail.canDelete, false);

  // The tab that was writing can no longer save or take the lock
  const saved = await EditorItem(
    request(
      ANNA,
      'PUT',
      { id: String(id) },
      {
        token: TOKEN_A,
        etag: detail.etag,
        title: draft.title,
        date: draft.date,
        inhalt: draft.inhalt,
        aktiverPunkt: null,
      }
    ),
    context
  );
  assert.equal(saved.status, 409);
  assert.equal((saved.jsonBody as { code: string }).code, 'NOT_EDITABLE');
  const lock = await EditorSperre(
    request(ANNA, 'POST', { id: String(id) }, { token: TOKEN_A }),
    context
  );
  assert.equal(lock.status, 409);

  const again = await EditorReview(
    review(ANNA, id, { action: 'review', etag: detail.etag }),
    context
  );
  assert.equal(again.status, 400);
});

dbTest('nobody gives minutes to the review while someone else writes', async (t) => {
  setup(t);
  const context = quietContext(t);
  const id = await create(t, context);
  await EditorSperre(request(CARL, 'POST', { id: String(id) }, { token: TOKEN_C }), context);
  const detail = await load(ANNA, id);
  const blocked = await EditorReview(
    review(ANNA, id, { action: 'review', etag: detail.etag, token: TOKEN_A }),
    context
  );
  assert.equal(blocked.status, 423);

  const outdated = await EditorReview(
    review(CARL, id, { action: 'review', etag: '"0000000000000000"', token: TOKEN_C }),
    context
  );
  assert.equal(outdated.status, 409);
  assert.equal((await load(ANNA, id)).status, 'entwurf');
});

dbTest('any leader sends minutes back with a note that goes to the author', async (t) => {
  setup(t);
  const context = quietContext(t);
  const mails = t.mock.method(mail, 'sendMail', async () => undefined);
  const { id, detail } = await inReview(t, context);

  const empty = await EditorReview(
    review(BEN, id, { action: 'reject', etag: detail.etag, note: '  ' }),
    context
  );
  assert.equal(empty.status, 400);
  assert.ok((empty.jsonBody as { fields: Record<string, string> }).fields.note);

  const rejected = await EditorReview(
    review(BEN, id, { action: 'reject', etag: detail.etag, note: 'Bitte Punkt 3 ergänzen.' }),
    context
  );
  assert.equal(rejected.status, 200);
  assert.deepEqual(rejected.jsonBody, { mailSent: true });
  assert.equal(mails.mock.callCount(), 1);
  const [to, subject, html, sender] = mails.mock.calls[0].arguments.map(String);
  assert.equal(to, ANNA);
  assert.match(subject, /Leitendenrunde vom 14\.10\.2026/);
  assert.match(html, /Bitte Punkt 3 ergänzen\./);
  assert.match(html, /\/leitendenbereich\/protokolle\/protokoll\?id=/);
  assert.equal(sender, SENDER);

  const back = await load(ANNA, id);
  assert.equal(back.status, 'entwurf');
  assert.equal(back.reviewNote, 'Bitte Punkt 3 ergänzen.');
  // Writing works again
  const lock = await EditorSperre(
    request(ANNA, 'POST', { id: String(id) }, { token: TOKEN_A }),
    context
  );
  assert.equal(lock.status, 200);
});

dbTest('the approval files the PDF in the folder of the minutes', async (t) => {
  const { uploads, files } = setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);

  // One's own minutes only with an explicit confirmation
  const own = await EditorReview(
    review(ANNA, id, { action: 'approve', etag: detail.etag }),
    context
  );
  assert.equal(own.status, 400);
  assert.equal(uploads.length, 0);

  const approved = await EditorReview(
    review(BEN, id, { action: 'approve', etag: detail.etag }),
    context
  );
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.jsonBody, { fileName: '2026-10-14 Leitendenrunde.pdf' });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].folder, CONFIG.protokolle.folderPath);
  assert.equal(Buffer.from(uploads[0].content.subarray(0, 5)).toString(), '%PDF-');

  const after = await load(ANNA, id);
  assert.equal(after.status, 'freigegeben');
  assert.equal(after.approvedBy, BEN);
  assert.deepEqual(after.ablage, {
    fileName: '2026-10-14 Leitendenrunde.pdf',
    webUrl: 'https://sharepoint.test/2026-10-14%20Leitendenrunde.pdf',
  });
  // The Word list leaves the file out; the minutes no longer change
  assert.deepEqual([...(await editorAblageItemIds('drive-1'))], ['item-1']);
  const lock = await EditorSperre(
    request(ANNA, 'POST', { id: String(id) }, { token: TOKEN_A }),
    context
  );
  assert.equal(lock.status, 409);

  // The download is the filed PDF
  const pdf = await GetEditorPdf(request(CARL, 'GET', { id: String(id) }), context);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body, files.get('item-1'));
});

dbTest('the author approves their own draft without a review after confirming', async (t) => {
  const { uploads } = setup(t);
  const context = quietContext(t);
  const id = await create(t, context);
  await EditorSperre(request(ANNA, 'POST', { id: String(id) }, { token: TOKEN_A }), context);
  const draft = await load(ANNA, id);

  const unconfirmed = await EditorReview(
    review(ANNA, id, { action: 'approve', etag: draft.etag, token: TOKEN_A }),
    context
  );
  assert.equal(unconfirmed.status, 400);
  assert.equal(uploads.length, 0);

  const approved = await EditorReview(
    review(ANNA, id, {
      action: 'approve',
      etag: draft.etag,
      token: TOKEN_A,
      ownConfirmed: true,
    }),
    context
  );
  assert.equal(approved.status, 200);
  assert.equal(uploads.length, 1);
  const after = await load(BEN, id);
  assert.equal(after.status, 'freigegeben');
  assert.equal(after.approvedBy, ANNA);
  assert.equal(after.submittedBy, '');
  assert.equal(after.sperre, null);
});

dbTest('nobody approves a draft while someone else writes', async (t) => {
  const { uploads } = setup(t);
  const context = quietContext(t);
  const id = await create(t, context);
  await EditorSperre(request(CARL, 'POST', { id: String(id) }, { token: TOKEN_C }), context);
  const draft = await load(BEN, id);
  const blocked = await EditorReview(
    review(BEN, id, { action: 'approve', etag: draft.etag, token: TOKEN_B }),
    context
  );
  assert.equal(blocked.status, 423);
  assert.equal(uploads.length, 0);
  assert.equal((await load(BEN, id)).status, 'entwurf');
});

dbTest('a taken name gets a number; a lost race removes the filed PDF', async (t) => {
  const { uploads, upload, removed } = setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);

  upload.mock.mockImplementationOnce(async () => {
    throw Object.assign(new Error('exists'), { statusCode: 409 });
  });
  const approved = await EditorReview(
    review(BEN, id, { action: 'approve', etag: detail.etag }),
    context
  );
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.jsonBody, { fileName: '2026-10-14 Leitendenrunde (2).pdf' });
  assert.equal(uploads.length, 1);

  // A second approval with the old version files nothing that stays
  const second = await inReview(t, context);
  await EditorReview(
    review(BEN, second.id, { action: 'reject', etag: second.detail.etag, note: 'x' }),
    context
  );
  const raced = await EditorReview(
    review(BEN, second.id, { action: 'approve', etag: second.detail.etag }),
    context
  );
  assert.equal(raced.status, 409);
  const stale = await load(ANNA, second.id);
  assert.equal(stale.status, 'entwurf');
  assert.equal(removed.mock.callCount(), 0);
});

dbTest('a version change during the approval removes the filed PDF again', async (t) => {
  const { upload, removed } = setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);
  // Someone sends the minutes back while the PDF is uploaded
  upload.mock.mockImplementationOnce(async () => {
    await EditorReview(
      review(BEN, id, { action: 'reject', etag: detail.etag, note: 'x' }),
      context
    );
    return { id: 'item-race', name: 'race.pdf', webUrl: '' };
  });
  const approved = await EditorReview(
    review(BEN, id, { action: 'approve', etag: detail.etag }),
    context
  );
  assert.equal(approved.status, 409);
  assert.equal(removed.mock.callCount(), 1);
  assert.equal(removed.mock.calls[0].arguments[1], 'item-race');
  assert.equal((await load(ANNA, id)).status, 'entwurf');
});

dbTest('approved minutes are mailed once to all leaders with the PDF', async (t) => {
  setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);
  await EditorReview(review(BEN, id, { action: 'approve', etag: detail.etag }), context);
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: '1', primary_email: 'lea@example.test', group_names: ['🐦‍🔥 Leiter*in'] },
    { id: '2', primary_email: 'max@example.test', group_names: ['Leiter*in'] },
    { id: '3', primary_email: 'kind@example.test', group_names: ['Wölflinge'] },
  ]);
  const sent = t.mock.method(mail, 'sendBlindCopyMail', async () => undefined);
  const versand = (login: string, body: Record<string, unknown>) =>
    EditorVersand(request(login, 'POST', { id: String(id) }, body), context);

  const preview = await versand(CARL, { action: 'preview' });
  assert.equal(preview.status, 200);
  const { recipients, version } = preview.jsonBody as { recipients: number; version: string };
  assert.equal(recipients, 2);

  const approved = await load(BEN, id);
  const wrongList = await versand(BEN, { action: 'send', etag: approved.etag, version: 'x' });
  assert.equal(wrongList.status, 400);
  const outdated = await versand(BEN, { action: 'send', etag: detail.etag, version });
  assert.equal(outdated.status, 409);
  assert.equal(sent.mock.callCount(), 0);

  const ok = await versand(BEN, { action: 'send', etag: approved.etag, version });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.jsonBody, { recipients: 2 });
  assert.equal(sent.mock.callCount(), 1);
  const [message] = sent.mock.calls[0].arguments;
  assert.ok(message);
  assert.equal(message.sender, SENDER);
  assert.deepEqual(message.bcc, ['lea@example.test', 'max@example.test']);
  assert.equal(message.attachments?.[0].name, protokollPdfFileName('2026-10-14', 'Leitendenrunde'));
  assert.match(message.html, /\/leitendenbereich\/protokolle\/protokoll\?id=/);

  const done = await load(BEN, id);
  assert.equal(done.status, 'verschickt');
  assert.equal(done.versand?.state, 'sent');
  assert.equal(done.versand?.recipients, 2);
  const twice = await versand(BEN, { action: 'send', etag: done.etag, version });
  assert.equal(twice.status, 400);
  assert.equal(sent.mock.callCount(), 1);
});

dbTest('an unconfirmed mailing needs a deliberate retry', async (t) => {
  setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);
  await EditorReview(review(BEN, id, { action: 'approve', etag: detail.etag }), context);
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: '1', primary_email: 'lea@example.test', group_names: ['Leiter*in'] },
  ]);
  const sent = t.mock.method(mail, 'sendBlindCopyMail', async () => {
    throw Object.assign(new Error('timeout'), { statusCode: 504 });
  });
  const versand = (body: Record<string, unknown>) =>
    EditorVersand(request(BEN, 'POST', { id: String(id) }, body), context);
  const { version } = (await versand({ action: 'preview' })).jsonBody as { version: string };

  const failed = await versand({ action: 'send', etag: (await load(BEN, id)).etag, version });
  assert.equal(failed.status, 500);
  const unknown = await load(BEN, id);
  assert.equal(unknown.status, 'freigegeben');
  assert.equal(unknown.versand?.state, 'attempted');

  const uncertain = await versand({ action: 'preview' });
  assert.equal(uncertain.status, 409);
  assert.equal((uncertain.jsonBody as { code: string }).code, 'UNCERTAIN');

  sent.mock.mockImplementation(async () => undefined);
  const retried = await versand({ action: 'send', etag: unknown.etag, version, retry: true });
  assert.equal(retried.status, 200);
  assert.equal((await load(BEN, id)).status, 'verschickt');
});

dbTest('a refused mail clears the reservation', async (t) => {
  setup(t);
  const context = quietContext(t);
  const { id, detail } = await inReview(t, context);
  await EditorReview(review(BEN, id, { action: 'approve', etag: detail.etag }), context);
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: '1', primary_email: 'lea@example.test', group_names: ['Leiter*in'] },
  ]);
  t.mock.method(mail, 'sendBlindCopyMail', async () => {
    throw Object.assign(new Error('bad request'), { statusCode: 400 });
  });
  const versand = (body: Record<string, unknown>) =>
    EditorVersand(request(BEN, 'POST', { id: String(id) }, body), context);
  const { version } = (await versand({ action: 'preview' })).jsonBody as { version: string };
  const failed = await versand({ action: 'send', etag: (await load(BEN, id)).etag, version });
  assert.equal(failed.status, 500);
  const after = await load(BEN, id);
  assert.equal(after.status, 'freigegeben');
  assert.equal(after.versand, null);
});

dbTest('drafts download as a fresh PDF marked as draft', async (t) => {
  const { uploads } = setup(t);
  const context = quietContext(t);
  const id = await create(t, context);
  const pdf = await GetEditorPdf(request(CARL, 'GET', { id: String(id) }), context);
  assert.equal(pdf.status, 200);
  assert.equal((pdf.headers as Record<string, string>)['Content-Type'], 'application/pdf');
  assert.match(
    (pdf.headers as Record<string, string>)['Content-Disposition'],
    /2026-10-14%20Leitendenrunde\.pdf/
  );
  assert.equal(Buffer.from((pdf.body as Uint8Array).subarray(0, 5)).toString(), '%PDF-');
  assert.equal(uploads.length, 0);
  const missing = await GetEditorPdf(request(CARL, 'GET', { id: '999999' }), context);
  assert.equal(missing.status, 404);
});

test('the PDF has a cover page with only the contents, then the minutes', async () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id-${n++}`);
  const definition = await protokollPdfDefinition({
    title: 'Leitendenrunde',
    date: '2026-10-14',
    inhalt,
    vorstaende: [],
    freigabe: null,
  });
  const [deckblatt, protokoll] = definition.content as {
    section: { toc?: unknown; tocItem?: boolean; text?: string }[];
    header: unknown;
    footer: unknown;
  }[];
  assert.ok(deckblatt.section.some((node) => node.toc));
  assert.equal(deckblatt.header, null);
  assert.ok(!deckblatt.section.some((node) => node.tocItem));
  assert.deepEqual(
    protokoll.section.filter((node) => node.tocItem).map((node) => node.text),
    ['Sitzung', '1. Stufenberichte', '2. Reflexion', '3. Planung', '4. Sonstiges']
  );
  assert.notEqual(deckblatt.footer, protokoll.footer);
});

test('the PDF renders Markdown, Termine and the people of the head like the page', async () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id-${n++}`, {
    sitzungsleitung: [
      { login: '', name: 'Vera Vorstand' },
      { login: '', name: 'Volker Vorstand' },
    ],
    protokollant: [{ login: '', name: 'Paula Protokoll' }],
  });
  inhalt.punkte[1].text = [
    'Mit **fett** und [Link](https://dpsg.de) und [böse](javascript:alert(1))',
    '',
    '1. eins',
    '- [x] erledigt',
    '',
    '| Was | Wer |',
    '| --- | --- |',
    '| Zelte | Lea |',
    '',
    '<script>alert(1)</script>',
  ].join('\n');
  inhalt.punkte[2].termine = [
    {
      id: 'termin-1',
      titel: 'Vortreffen',
      datum: '2026-11-02',
      uhrzeit: '18:00',
      ort: 'Stammesheim',
      zustaendig: [{ login: '', name: 'Lea Leiterin' }],
    },
  ];
  const input = {
    title: 'Leitendenrunde',
    date: '2026-10-14',
    inhalt,
    vorstaende: [],
    freigabe: null,
  };
  const json = JSON.stringify((await protokollPdfDefinition(input)).content);
  assert.match(json, /"text":"Vera Vorstand, Volker Vorstand"/);
  assert.match(json, /"text":\[\{"text":"fett"\}\],"bold":true/);
  assert.match(json, /"link":"https:\/\/dpsg.de"/);
  assert.doesNotMatch(json, /"link":"javascript/);
  assert.match(json, /\[böse\]\(javascript:alert\(1\)\)/);
  assert.match(json, /"ol":/);
  assert.match(json, /"\[x\]"/);
  assert.match(json, /"text":"Zelte"/);
  assert.match(json, /<script>alert\(1\)<\/script>/);
  assert.match(json, /Vortreffen.*Mo\., 02\.11\.2026, 18:00 Uhr – Stammesheim – Lea Leiterin/);
  const pdf = await createProtokollPdf(input);
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-');
});
