import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as campflow from '../lib/campflow';
import * as mail from '../lib/mail';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import {
  ProtokolleCollection,
  ProtokollItem,
  ProtokollVersand,
  ProtokollVorschau,
} from '../endpoints/intern-pflege-protokolle';
import type { ProtokollDriveItem, ProtokollFields } from '../lib/protokolle';
import {
  audienceVersion,
  isProtokollFile,
  parseProtokollFileName,
  protokollRecipients,
  protokollTransition,
  toStaffProtokoll,
} from '../lib/protokolle';
import { ValidationError } from '../lib/pflege-validation';

const AUTHOR = {
  identityProvider: 'aad',
  userId: 'author',
  userDetails: 'autorin@example.test',
  userRoles: ['authenticated'],
};
const REVIEWER = { ...AUTHOR, userId: 'reviewer', userDetails: 'stavo@example.test' };
const ETAG = '"item,4"';

function driveItem(fields: ProtokollFields, overrides: Partial<ProtokollDriveItem> = {}) {
  return {
    id: 'P1',
    name: '2026-10-07 Leitendenrunde.docx',
    webUrl: 'https://sharepoint.example/doc.aspx',
    cTag: '"c:{P1},3"',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    parentReference: { path: '/drives/drive-1/root:/Protokolle/Leitendenrunde' },
    lastModifiedDateTime: '2026-10-07T20:00:00Z',
    lastModifiedBy: { user: { displayName: 'Alex' } },
    listItem: { eTag: ETAG, fields },
    ...overrides,
  };
}

const LEADER = {
  id: 'prs_1',
  primary_email: 'Leiterin@Example.test',
  cc_emails: ['eltern@example.test'],
  group_names: ['🐦‍🔥 Leiter*in'],
};

function setup(t: TestContext): InvocationContext {
  overrideConfig(t, CONFIG.protokolle, {
    library: 'Unterlagen',
    folderPath: 'Protokolle/Leitendenrunde',
    templateUrl: 'https://sharepoint.example/:w:/s/leitende/vorlage',
    reviewers: [],
    sender: 'protokolle@example.test',
    campflowGroups: ['Leiter*in'],
  });
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  const context = new InvocationContext({ functionName: 'protokolle-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'warn', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

function request(
  method: string,
  body?: unknown,
  options: { id?: string; principal?: unknown; path?: string; etag?: string } = {}
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.etag) headers['if-match'] = options.etag;
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? AUTHOR)
    ).toString('base64');
  }
  return new HttpRequest({
    url: `http://localhost/api/intern/pflege/protokolle${options.path ?? ''}`,
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

test('file names carry the date and title of the meeting', () => {
  assert.deepEqual(parseProtokollFileName('2026-10-07 Leitendenrunde.docx'), {
    date: '2026-10-07',
    title: 'Leitendenrunde',
  });
  assert.deepEqual(parseProtokollFileName('Protokoll LR 12.3.25.docx'), {
    date: '2025-03-12',
    title: 'Protokoll LR',
  });
  assert.deepEqual(parseProtokollFileName('Leitendenrunde_2024-11-05.docx'), {
    date: '2024-11-05',
    title: 'Leitendenrunde',
  });
  assert.deepEqual(parseProtokollFileName('Altes Protokoll.docx'), {
    date: '',
    title: 'Altes Protokoll',
  });
});

test('recipients are current leaders with their primary address only', () => {
  const persons = [
    LEADER,
    { ...LEADER, id: 'prs_2', primary_email: 'leiterin@example.test' },
    { ...LEADER, id: 'prs_3', primary_email: 'kind@example.test', group_names: ['🟠 Wölfling'] },
    { ...LEADER, id: 'prs_4', primary_email: 'alt@example.test', leave_date: '2026-01-01' },
    { ...LEADER, id: 'prs_5', primary_email: 'neu@example.test', join_date: '2027-01-01' },
    { ...LEADER, id: 'prs_6', primary_email: 'keine-adresse' },
    { ...LEADER, id: 'prs_7', primary_email: 'stavo@example.test', group_names: ['Leitende'] },
  ];
  assert.deepEqual(protokollRecipients(persons, '2026-10-07', ['Leiter*in', 'Leitende']), [
    'leiterin@example.test',
    'stavo@example.test',
  ]);
});

test('the author cannot approve their own minutes', (t) => {
  overrideConfig(t, CONFIG.protokolle, { reviewers: [] });
  const protokoll = toStaffProtokoll(
    driveItem({ Status: 'Review', ErstelltVon: AUTHOR.userDetails })
  );
  const options = { cTag: 'c', note: '', now: new Date('2026-10-08T10:00:00Z') };
  assert.throws(() => protokollTransition(protokoll, 'approve', AUTHOR, options), ValidationError);
  assert.deepEqual(protokollTransition(protokoll, 'approve', REVIEWER, options), {
    Status: 'Freigegeben',
    FreigegebenVon: REVIEWER.userDetails,
    FreigegebenAm: '2026-10-08T10:00:00.000Z',
    FreigabeVersion: 'c',
  });
});

test('only configured reviewers approve, and sending back needs a note', (t) => {
  overrideConfig(t, CONFIG.protokolle, { reviewers: ['Stavo@example.test'] });
  const protokoll = toStaffProtokoll(
    driveItem({ Status: 'Review', ErstelltVon: 'x@example.test' })
  );
  const options = { cTag: 'c', note: '', now: new Date() };
  assert.throws(() => protokollTransition(protokoll, 'approve', AUTHOR, options), ValidationError);
  assert.doesNotThrow(() => protokollTransition(protokoll, 'approve', REVIEWER, options));
  assert.throws(() => protokollTransition(protokoll, 'reject', REVIEWER, options), ValidationError);
});

test('files without a status are archived and files outside the folder are ignored', () => {
  assert.equal(toStaffProtokoll(driveItem({})).status, 'Archiv');
  assert.equal(isProtokollFile(driveItem({}), 'Protokolle/Leitendenrunde'), true);
  assert.equal(
    isProtokollFile(
      driveItem({}, { parentReference: { path: '/drives/drive-1/root:/Protokolle' } }),
      'Protokolle/Leitendenrunde'
    ),
    false
  );
  assert.equal(
    isProtokollFile(driveItem({}, { name: 'Notizen.pdf' }), 'Protokolle/Leitendenrunde'),
    false
  );
});

test('an edit after the approval is detected by the content tag', () => {
  const approved = { Status: 'Freigegeben', FreigabeVersion: '"c:{P1},3"' };
  assert.equal(toStaffProtokoll(driveItem(approved)).changedSinceApproval, false);
  assert.equal(
    toStaffProtokoll(driveItem(approved, { cTag: '"c:{P1},4"' })).changedSinceApproval,
    true
  );
});

test('minutes reject anonymous identities before accessing SharePoint', async (t) => {
  const context = setup(t);
  const list = t.mock.method(
    sharePoint,
    'getSharePointDriveFolderChildrenWithFields',
    async () => []
  );
  const response = await ProtokolleCollection(
    request('GET', undefined, { principal: null }),
    context
  );
  assert.equal(response.status, 401);
  assert.equal(list.mock.callCount(), 0);
});

test('new minutes are copied from the template and marked as draft of the author', async (t) => {
  const context = setup(t);
  const template = new Uint8Array([1, 2, 3]);
  const read = t.mock.method(sharePoint, 'getSharedFileContent', async () => template);
  const create = t.mock.method(sharePoint, 'createSharePointDriveFile', async () => ({
    id: 'NEW',
    webUrl: 'https://sharepoint.example/new',
  }));
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );

  const response = await ProtokolleCollection(
    request('POST', { title: '  Leitendenrunde  ', date: '2026-10-07' }),
    context
  );
  assert.equal(response.status, 201);
  assert.deepEqual(response.jsonBody, { id: 'NEW', webUrl: 'https://sharepoint.example/new' });
  assert.deepEqual(read.mock.calls[0].arguments, [
    'https://sharepoint.example/:w:/s/leitende/vorlage',
  ]);
  assert.deepEqual(create.mock.calls[0].arguments, [
    'drive-1',
    'Protokolle/Leitendenrunde',
    '2026-10-07 Leitendenrunde.docx',
    template,
  ]);
  assert.deepEqual(update.mock.calls[0].arguments, [
    'drive-1',
    'NEW',
    { Status: 'Entwurf', ErstelltVon: AUTHOR.userDetails },
  ]);
});

test('a new file is removed again if its status cannot be stored', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharedFileContent', async () => new Uint8Array([1]));
  t.mock.method(sharePoint, 'createSharePointDriveFile', async () => ({ id: 'NEW' }));
  t.mock.method(sharePoint, 'updateSharePointDriveItemFields', async () => {
    throw Object.assign(new Error('Column missing'), { statusCode: 400 });
  });
  const remove = t.mock.method(sharePoint, 'deleteSharePointDriveItem', async () => undefined);

  const response = await ProtokolleCollection(
    request('POST', { title: 'Leitendenrunde', date: '2026-10-07' }),
    context
  );
  assert.equal(response.status, 500);
  assert.deepEqual(remove.mock.calls[0].arguments, ['drive-1', 'NEW']);
});

test('invalid titles and dates are rejected before copying', async (t) => {
  const context = setup(t);
  const read = t.mock.method(sharePoint, 'getSharedFileContent', async () => {
    throw new Error('not expected');
  });
  const response = await ProtokolleCollection(
    request('POST', { title: 'a/b', date: '2026-02-30' }),
    context
  );
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys((response.jsonBody as { fields: object }).fields).sort(), [
    'date',
    'title',
  ]);
  assert.equal(read.mock.callCount(), 0);
});

test('a stale version is refused when changing the review state', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem({ Status: 'Entwurf' })
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );
  const response = await ProtokollItem(
    request('POST', { action: 'review', etag: '"item,3"' }, { id: 'P1' }),
    context
  );
  assert.equal(response.status, 409);
  assert.equal(update.mock.callCount(), 0);
});

function mockSending(t: TestContext, fields: ProtokollFields, cTag = '"c:{P1},3"') {
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem(
      { FreigabeVersion: '"c:{P1},3"', FreigegebenVon: REVIEWER.userDetails, ...fields },
      { cTag }
    )
  );
  t.mock.method(campflow, 'campflowGetAll', async () => [LEADER]);
  const pdf = t.mock.method(
    sharePoint,
    'getSharePointDriveFileContent',
    async () => new Uint8Array([37, 80, 68, 70])
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );
  return { pdf, update };
}

const VERSION = audienceVersion(['leiterin@example.test']);

test('approved minutes are reserved, mailed in blind copy and then marked as sent', async (t) => {
  const context = setup(t);
  const { update } = mockSending(t, { Status: 'Freigegeben' });
  const send = t.mock.method(mail, 'sendBlindCopyMail', async () => undefined);

  const preview = await ProtokollVersand(
    request('POST', { action: 'preview' }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.deepEqual(preview.jsonBody, { recipients: 1, version: VERSION });

  const response = await ProtokollVersand(
    request(
      'POST',
      { action: 'send', version: VERSION, etag: ETAG },
      { id: 'P1', principal: REVIEWER }
    ),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(send.mock.callCount(), 1);
  const [message] = send.mock.calls[0].arguments as unknown as Parameters<
    typeof mail.sendBlindCopyMail
  >;
  assert.equal(message.sender, 'protokolle@example.test');
  assert.deepEqual(message.bcc, ['leiterin@example.test']);
  assert.equal(message.subject, 'Protokoll: Leitendenrunde vom 07.10.2026');
  assert.equal(message.attachments?.[0].name, '2026-10-07 Leitendenrunde.pdf');
  assert.match(message.html, /\/leitendenbereich\/protokolle\/#protokoll-P1/);

  const [reserve, done] = update.mock.calls.map(
    (call) =>
      call.arguments as unknown as Parameters<typeof sharePoint.updateSharePointDriveItemFields>
  );
  assert.equal(JSON.parse(String(reserve[2].Versand)).state, 'attempted');
  assert.equal(reserve[3], ETAG);
  assert.equal(done[2].Status, 'Verschickt');
  assert.equal(JSON.parse(String(done[2].Versand)).state, 'sent');
});

test('a refused mail clears the reservation, an unanswered one keeps it', async (t) => {
  const context = setup(t);
  const { update } = mockSending(t, { Status: 'Freigegeben' });
  const send = t.mock.method(mail, 'sendBlindCopyMail', async () => {
    throw Object.assign(new Error('Bad request'), { statusCode: 400 });
  });
  const body = { action: 'send', version: VERSION, etag: ETAG };
  const refused = await ProtokollVersand(
    request('POST', body, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(refused.status, 500);
  assert.deepEqual(update.mock.calls[1].arguments[2], { Versand: '' });

  send.mock.mockImplementation(async () => {
    throw new Error('socket hang up');
  });
  await ProtokollVersand(request('POST', body, { id: 'P1', principal: REVIEWER }), context);
  assert.equal(update.mock.callCount(), 3);
});

test('an unconfirmed earlier attempt needs an explicit retry', async (t) => {
  const context = setup(t);
  mockSending(t, {
    Status: 'Freigegeben',
    Versand: JSON.stringify({ state: 'attempted', recipients: 1, at: '', by: '' }),
  });
  const send = t.mock.method(mail, 'sendBlindCopyMail', async () => undefined);
  const body = { action: 'send', version: VERSION, etag: ETAG };

  const blocked = await ProtokollVersand(
    request('POST', body, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal((blocked.jsonBody as { code: string }).code, 'UNCERTAIN');
  assert.equal(send.mock.callCount(), 0);

  const retried = await ProtokollVersand(
    request('POST', { ...body, retry: true }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(retried.status, 200);
  assert.equal(send.mock.callCount(), 1);
});

test('minutes edited after the approval are not sent', async (t) => {
  const context = setup(t);
  const { update } = mockSending(t, { Status: 'Freigegeben' }, '"c:{P1},4"');
  const response = await ProtokollVersand(
    request(
      'POST',
      { action: 'send', version: VERSION, etag: ETAG },
      { id: 'P1', principal: REVIEWER }
    ),
    context
  );
  assert.equal((response.jsonBody as { code: string }).code, 'CHANGED');
  assert.equal(update.mock.callCount(), 0);
});

test('a changed list of leaders must be confirmed again', async (t) => {
  const context = setup(t);
  const { update } = mockSending(t, { Status: 'Freigegeben' });
  const response = await ProtokollVersand(
    request(
      'POST',
      { action: 'send', version: 'old', etag: ETAG },
      { id: 'P1', principal: REVIEWER }
    ),
    context
  );
  assert.equal(response.status, 400);
  assert.equal(update.mock.callCount(), 0);
});

test('other files of the library cannot be changed through their ID', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem({ Status: 'Entwurf' }, { parentReference: { path: '/drives/drive-1/root:/Kasse' } })
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );
  const response = await ProtokollItem(
    request('POST', { action: 'review', etag: ETAG }, { id: 'P1' }),
    context
  );
  assert.equal(response.status, 404);
  assert.equal(update.mock.callCount(), 0);
});

test('the read-only preview is only created for minutes in the folder', async (t) => {
  const context = setup(t);
  const item = t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem({ Status: 'Review' })
  );
  const preview = t.mock.method(
    sharePoint,
    'getSharePointDriveItemPreviewUrl',
    async () => 'https://sharepoint.example/embed?token=1'
  );
  const response = await ProtokollVorschau(request('GET', undefined, { id: 'P1' }), context);
  assert.deepEqual(response.jsonBody, { url: 'https://sharepoint.example/embed?token=1' });
  assert.deepEqual(preview.mock.calls[0].arguments, ['drive-1', 'P1']);

  item.mock.mockImplementation(async () =>
    driveItem({}, { parentReference: { path: '/drives/drive-1/root:/Kasse' } })
  );
  const other = await ProtokollVorschau(request('GET', undefined, { id: 'P1' }), context);
  assert.equal(other.status, 404);
  assert.equal(preview.mock.callCount(), 1);
});

test('drafts are deleted by their author, sent minutes are kept', async (t) => {
  const context = setup(t);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  const item = t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem({ Status: 'Entwurf', ErstelltVon: AUTHOR.userDetails })
  );
  const remove = t.mock.method(sharePoint, 'deleteSharePointDriveItem', async () => undefined);
  const del = (principal: unknown, etag = ETAG) =>
    ProtokollItem(request('DELETE', undefined, { id: 'P1', principal, etag }), context);

  assert.equal((await del({ ...AUTHOR, userDetails: 'andere@example.test' })).status, 400);
  assert.equal((await del(AUTHOR, '"item,3"')).status, 409);
  assert.equal(remove.mock.callCount(), 0);

  assert.equal((await del(AUTHOR)).status, 204);
  assert.deepEqual(remove.mock.calls[0].arguments, ['drive-1', 'P1']);

  item.mock.mockImplementation(async () =>
    driveItem({ Status: 'Verschickt', ErstelltVon: AUTHOR.userDetails })
  );
  assert.equal((await del(REVIEWER)).status, 400);
  assert.equal(remove.mock.callCount(), 1);
});
