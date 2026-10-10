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
  ProtokollTermin,
  ProtokollVersand,
  ProtokollVorschau,
} from '../endpoints/intern-pflege-protokolle';
import type { ProtokollDriveItem, ProtokollFields, StaffProtokoll } from '../lib/protokolle';
import {
  audienceVersion,
  isProtokollFile,
  parseProtokollFileName,
  protokollRecipients,
  protokollTransition,
  toStaffProtokoll,
} from '../lib/protokolle';
import { ValidationError } from '../lib/pflege-validation';
import type { ProtokollTermin as StoredTermin } from '../lib/protokoll-termin';
import { parseProtokollTermin, terminWithoutSuggestion } from '../lib/protokoll-termin';
import { docx, paragraph } from './fixtures/docx';
import * as contentVersion from '../lib/protokoll-content-version';

const realContentResolver = contentVersion.withProtokollContentVersion;

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
    // No model unless a test sets one, so nothing reaches Azure OpenAI by accident
    termin: { endpoint: '', deployment: '', maxExtractionsPerDay: 1000 },
  });
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  // Existing cases exercise legacy cTag records; fingerprint cases restore the real resolver.
  t.mock.method(
    contentVersion,
    'withProtokollContentVersion',
    async (_drive: string, item: ProtokollDriveItem) => item
  );
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

test('the suggestion of archived minutes goes stale when the file changes', () => {
  const termin = JSON.stringify({
    sourceVersion: 'c1',
    extraction: 'gefunden',
    suggestion: { date: '2026-10-14', time: null, place: null, quote: 'Nächste Runde am 14.10.' },
    decision: 'offen',
    confirmed: null,
    decidedBy: '',
    decidedAt: '',
    extractedAt: '2026-10-10T08:00:00.000Z',
  });
  assert.equal(toStaffProtokoll(driveItem({ Termin: termin }, { cTag: 'c1' })).terminStale, false);
  assert.equal(toStaffProtokoll(driveItem({ Termin: termin }, { cTag: 'c2' })).terminStale, true);
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

// --- Next meeting -------------------------------------------------------------------------

const QUOTE = 'Die nächste LR ist am 4. November um 19:30 Uhr im Pfadiheim.';
const WORD_FILE = docx(paragraph('TOP 7 Verschiedenes') + paragraph(QUOTE));
const MODEL_ANSWER = {
  status: 'gefunden',
  date: '2026-11-04',
  time: '19:30',
  place: 'Pfadiheim',
  quote: QUOTE,
};
const APPROVED_VERSION = '"c:{P1},3"';

function withModel(t: TestContext, answer: unknown = MODEL_ANSWER, status = 200) {
  Object.assign(CONFIG.protokolle.termin, {
    endpoint: 'https://example.openai.azure.com',
    deployment: 'gpt-4.1-mini',
  });
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  });
  const file = t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => WORD_FILE);
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        { status }
      )
  );
  return { file, fetch };
}

function storedTermin(update: { mock: { calls: { arguments: unknown[] }[] } }, call: number) {
  const fields = update.mock.calls[call].arguments[2] as ProtokollFields;
  return parseProtokollTermin(fields.Termin);
}

function mockApproval(t: TestContext) {
  const fields: ProtokollFields = { Status: 'Review', ErstelltVon: AUTHOR.userDetails };
  const item = { ...driveItem(fields), listItem: { eTag: ETAG, fields } };
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  let revision = 4;
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async (_drive: string, _id: string, fields: Record<string, unknown>, etag?: string) => {
      if (etag && etag !== item.listItem.eTag) {
        throw Object.assign(new Error('Version changed'), { statusCode: 412 });
      }
      Object.assign((item.listItem.fields ??= {}), fields);
      item.listItem.eTag = `"item,${++revision}"`;
    }
  );
  return { item, update };
}

test('approving reads the next date from exactly the approved version', async (t) => {
  const context = setup(t);
  const { file } = withModel(t);
  const { update } = mockApproval(t);
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  // The Word file itself, not the PDF conversion
  assert.deepEqual(file.mock.calls[0].arguments, ['drive-1', 'P1']);
  assert.equal(update.mock.callCount(), 2);
  assert.equal(update.mock.calls[0].arguments[3], ETAG);
  assert.equal(update.mock.calls[1].arguments[3], '"item,5"');
  const termin = storedTermin(update, 1);
  // Defect: a suggestion not tied to the approved cTag could not be recognized as stale later
  assert.equal(termin?.sourceVersion, APPROVED_VERSION);
  assert.equal(termin?.extraction, 'gefunden');
  assert.equal(termin?.decision, 'offen');
  assert.deepEqual(termin?.suggestion, {
    date: '2026-11-04',
    time: '19:30',
    place: 'Pfadiheim',
    quote: QUOTE,
  });
});

test('a failing model or a missing column never blocks the approval', async (t) => {
  const context = setup(t);
  withModel(t, {}, 500);
  const { item, update } = mockApproval(t);
  const approve = () =>
    ProtokollItem(
      request('POST', { action: 'approve', etag: ETAG }, { id: 'P1', principal: REVIEWER }),
      context
    );
  assert.equal((await approve()).status, 200);
  assert.equal(storedTermin(update, 1)?.extraction, 'fehler');
  // Defect: the warning would carry the text of the minutes into the logs
  const warnings = JSON.stringify(
    (context.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls
  );
  assert.doesNotMatch(warnings, /Pfadiheim|nächste LR/);

  update.mock.mockImplementation(async (_drive, _id, fields: Record<string, unknown>) => {
    if ('Termin' in fields) throw Object.assign(new Error('Column missing'), { statusCode: 400 });
    Object.assign((item.listItem.fields ??= {}), fields);
  });
  item.listItem.fields.Status = 'Review';
  item.listItem.eTag = ETAG;
  assert.equal((await approve()).status, 200);
});

test('reopening clears the suggestion, but only where one is stored', () => {
  const termin = serialize(terminWithoutSuggestion('fehler', APPROVED_VERSION));
  const options = { cTag: APPROVED_VERSION, note: '', now: new Date() };
  const withTermin = toStaffProtokoll(driveItem({ Status: 'Freigegeben', Termin: termin }));
  assert.equal(protokollTransition(withTermin, 'reopen', REVIEWER, options).Termin, '');
  // Libraries without the column keep working
  const without = toStaffProtokoll(driveItem({ Status: 'Freigegeben' }));
  assert.equal('Termin' in protokollTransition(without, 'reopen', REVIEWER, options), false);
});

function serialize(termin: StoredTermin): string {
  return JSON.stringify(termin);
}

test('the list reports the suggestion and whether it is stale', async (t) => {
  const context = setup(t);
  const termin = serialize(terminWithoutSuggestion('nicht gefunden', APPROVED_VERSION));
  const fields = { Status: 'Freigegeben', FreigabeVersion: APPROVED_VERSION, Termin: termin };
  t.mock.method(sharePoint, 'getSharePointDriveFolderChildrenWithFields', async () => [
    driveItem(fields),
    driveItem(fields, { id: 'P2', cTag: '"c:{P2},9"' }),
  ]);
  const response = await ProtokolleCollection(request('GET'), context);
  const body = response.jsonBody as {
    terminConfigured: boolean;
    items: { termin: StoredTermin | null; terminStale: boolean }[];
  };
  assert.equal(body.terminConfigured, false);
  assert.equal(body.items[0].termin?.extraction, 'nicht gefunden');
  assert.deepEqual(
    body.items.map((item) => item.terminStale),
    [false, true]
  );
});

function mockTermin(t: TestContext, fields: ProtokollFields, cTag = APPROVED_VERSION) {
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem(
      {
        Status: 'Freigegeben',
        FreigabeVersion: APPROVED_VERSION,
        Termin: serialize(terminWithoutSuggestion('fehler', APPROVED_VERSION)),
        ...fields,
      },
      { cTag }
    )
  );
  return t.mock.method(sharePoint, 'updateSharePointDriveItemFields', async () => undefined);
}

function terminRequest(body: Record<string, unknown>, principal: unknown = REVIEWER) {
  return request('POST', { etag: ETAG, ...body }, { id: 'P1', principal, path: '/P1/termin' });
}

test('reviewers confirm the next date by hand after a failed detection', async (t) => {
  const context = setup(t);
  const update = mockTermin(t, {});
  const response = await ProtokollTermin(
    terminRequest({ action: 'bestaetigen', date: '2026-11-04', time: '19:30', place: 'Heim' }),
    context
  );
  assert.equal(response.status, 200);
  const { termin } = response.jsonBody as { termin: StoredTermin };
  assert.equal(termin.decision, 'bestaetigt');
  assert.deepEqual(termin.confirmed, { date: '2026-11-04', time: '19:30', place: 'Heim' });
  assert.equal(termin.decidedBy, REVIEWER.userDetails);
  assert.deepEqual(storedTermin(update, 0), termin);
  assert.equal(update.mock.calls[0].arguments[3], ETAG);
});

test('the next date is refused to non-reviewers, stale versions and invalid input', async (t) => {
  const context = setup(t);
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
  const update = mockTermin(t, {});
  const send = (body: Record<string, unknown>, principal?: unknown) =>
    ProtokollTermin(terminRequest(body, principal), context);

  // Defect: any leader could confirm or reject the date of the next meeting
  assert.equal((await send({ action: 'ablehnen' }, AUTHOR)).status, 400);
  assert.equal((await send({ action: 'ablehnen', etag: '"item,3"' })).status, 409);
  assert.equal((await send({ action: 'bestaetigen', date: '2026-10-01' })).status, 400);
  assert.equal((await send({ action: 'loeschen' })).status, 400);
  assert.equal(update.mock.callCount(), 0);

  assert.equal((await send({ action: 'ablehnen' })).status, 200);
  assert.equal(storedTermin(update, 0)?.decision, 'abgelehnt');
});

test('a reviewer can start the detection again, but not on a changed file', async (t) => {
  const context = setup(t);
  const { fetch } = withModel(t);
  const confirmed = serialize({
    ...terminWithoutSuggestion('fehler', APPROVED_VERSION),
    decision: 'bestaetigt',
    confirmed: { date: '2026-11-11', time: null, place: null },
  });
  const update = mockTermin(t, { Status: 'Verschickt', Termin: confirmed });
  const response = await ProtokollTermin(terminRequest({ action: 'erkennen' }), context);
  assert.equal(response.status, 200);
  const { termin } = response.jsonBody as { termin: StoredTermin };
  // A new detection resets the earlier decision
  assert.equal(termin.extraction, 'gefunden');
  assert.equal(termin.decision, 'offen');
  assert.equal(termin.confirmed, null);
  assert.equal(update.mock.calls[0].arguments[3], ETAG);

  assert.equal(fetch.mock.callCount(), 1);

  // Edited after the approval: reading it would tie the date to a text nobody approved
  t.mock.restoreAll();
  const again = withModel(t);
  t.mock.method(sharePoint, 'getSharePointDriveIdByName', async () => 'drive-1');
  const changed = mockTermin(t, { Status: 'Freigegeben' }, '"c:{P1},4"');
  const refused = await ProtokollTermin(terminRequest({ action: 'erkennen' }), context);
  assert.equal(refused.status, 400);
  assert.equal(changed.mock.callCount(), 0);
  assert.equal(again.fetch.mock.callCount(), 0);
});

test('sent minutes edited after approval have a stale date and refuse all date actions', async (t) => {
  const context = setup(t);
  const { fetch } = withModel(t);
  const update = mockTermin(t, { Status: 'Verschickt' }, '"c:{P1},4"');
  const changed = toStaffProtokoll(
    driveItem(
      {
        Status: 'Verschickt',
        FreigabeVersion: APPROVED_VERSION,
        Termin: serialize(terminWithoutSuggestion('fehler', APPROVED_VERSION)),
      },
      { cTag: '"c:{P1},4"' }
    )
  );
  assert.equal(changed.changedSinceApproval, true);
  assert.equal(changed.terminStale, true);
  for (const action of ['erkennen', 'bestaetigen', 'ablehnen']) {
    const response = await ProtokollTermin(terminRequest({ action, date: '2026-11-04' }), context);
    assert.equal(response.status, 400, action);
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

test('stale archived minutes can be read again from their current version', async (t) => {
  const context = setup(t);
  withModel(t);
  const update = mockTermin(t, { Status: '', FreigabeVersion: '' }, '"c:{P1},4"');
  const response = await ProtokollTermin(terminRequest({ action: 'erkennen' }), context);
  assert.equal(response.status, 200);
  assert.equal(storedTermin(update, 0)?.sourceVersion, '"c:{P1},4"');
  assert.equal(storedTermin(update, 0)?.extraction, 'gefunden');
});

test('manual entry and rejection work without a previous model call', async (t) => {
  const context = setup(t);
  const update = mockTermin(t, { Status: '', FreigabeVersion: '', Termin: '' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No model expected');
  });
  for (const action of ['bestaetigen', 'ablehnen']) {
    const response = await ProtokollTermin(terminRequest({ action, date: '2026-11-04' }), context);
    assert.equal(response.status, 200, action);
    const { termin } = response.jsonBody as { termin: StoredTermin };
    assert.equal(termin.extraction, 'nicht ausgefuehrt');
    assert.equal(termin.extractedAt, '');
    assert.equal(termin.sourceVersion, APPROVED_VERSION);
    assert.equal(termin.decision, action === 'bestaetigen' ? 'bestaetigt' : 'abgelehnt');
  }
  assert.equal(update.mock.callCount(), 2);
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejected date storage explains the SharePoint setup without exposing document text', async (t) => {
  const context = setup(t);
  const update = mockTermin(t, { Status: '', FreigabeVersion: '', Termin: '' });
  update.mock.mockImplementation(async () => {
    throw Object.assign(new Error('Field Termin is not recognized: confidential protocol text'), {
      statusCode: 400,
    });
  });
  for (const action of ['erkennen', 'bestaetigen', 'ablehnen']) {
    const response = await ProtokollTermin(terminRequest({ action, date: '2026-11-04' }), context);
    assert.equal(response.status, 502, action);
    const body = response.jsonBody as { code: string; message: string };
    assert.equal(body.code, 'TERMIN_STORAGE_REJECTED');
    assert.match(body.message, /Spalte „Termin“.*„Unterlagen“.*Nur-Text/);
    assert.doesNotMatch(JSON.stringify(response.jsonBody), /confidential/);
  }
  assert.doesNotMatch(
    JSON.stringify((context.warn as unknown as { mock: unknown }).mock),
    /confidential/
  );
  update.mock.mockImplementation(async () => {
    throw Object.assign(new Error('Version changed'), { statusCode: 412 });
  });
  const conflict = await ProtokollTermin(terminRequest({ action: 'ablehnen' }), context);
  assert.equal(conflict.status, 409);
});

test('a changed file during download is never sent to the model', async (t) => {
  const context = setup(t);
  const { file, fetch } = withModel(t);
  const item = driveItem({ Status: 'Freigegeben', FreigabeVersion: APPROVED_VERSION });
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  file.mock.mockImplementation(async () => {
    item.cTag = '"c:{P1},4"';
    item.listItem.eTag = '"item,5"';
    return WORD_FILE;
  });
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );
  const response = await ProtokollTermin(terminRequest({ action: 'erkennen' }), context);
  assert.equal(response.status, 409);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

test('automatic detection keeps the approval when the file changes during download', async (t) => {
  const context = setup(t);
  const { file, fetch } = withModel(t);
  const { item, update } = mockApproval(t);
  file.mock.mockImplementation(async () => {
    item.cTag = '"c:{P1},4"';
    item.listItem.eTag = '"item,6"';
    return WORD_FILE;
  });
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(item.listItem.fields.Status, 'Freigegeben');
  assert.equal(update.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a zero extraction limit disables approval detection without downloading the file', async (t) => {
  const context = setup(t);
  const { file, fetch } = withModel(t);
  CONFIG.protokolle.termin.maxExtractionsPerDay = 0;
  const { item, update } = mockApproval(t);
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(item.listItem.fields.Status, 'Freigegeben');
  assert.equal(update.mock.callCount(), 2);
  assert.equal(storedTermin(update, 1)?.extraction, 'nicht eingerichtet');
  assert.equal(file.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
  t.mock.method(sharePoint, 'getSharePointDriveFolderChildrenWithFields', async () => [item]);
  const listed = await ProtokolleCollection(request('GET'), context);
  assert.equal((listed.jsonBody as { terminConfigured: boolean }).terminConfigured, false);
});

test('automatic detection cannot overwrite a concurrent reviewer decision', async (t) => {
  const context = setup(t);
  const { fetch } = withModel(t);
  const { item, update } = mockApproval(t);
  const manual = serialize({
    ...terminWithoutSuggestion('nicht ausgefuehrt', APPROVED_VERSION),
    decision: 'bestaetigt',
    confirmed: { date: '2026-11-11', time: null, place: 'online' },
  });
  fetch.mock.mockImplementation(async () => {
    item.listItem.fields.Termin = manual;
    item.listItem.eTag = '"item,6"';
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(MODEL_ANSWER) } }] })
    );
  });
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: 'P1', principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(item.listItem.fields.Status, 'Freigegeben');
  assert.equal(item.listItem.fields.Termin, manual);
  assert.equal(update.mock.calls[1].arguments[3], '"item,5"');
});

test('date endpoint requires staff authentication and stays inside the protocol folder', async (t) => {
  const context = setup(t);
  const read = t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () =>
    driveItem(
      { Status: 'Freigegeben' },
      { parentReference: { path: '/drives/drive-1/root:/Other' } }
    )
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async () => undefined
  );
  assert.equal(
    (await ProtokollTermin(terminRequest({ action: 'erkennen' }, null), context)).status,
    401
  );
  assert.equal(read.mock.callCount(), 0);
  assert.equal((await ProtokollTermin(terminRequest({ action: 'erkennen' }), context)).status, 404);
  assert.equal(update.mock.callCount(), 0);
});

test('SharePoint metadata promotion does not stale an archive, but a Word edit does', async (t) => {
  const context = setup(t);
  withModel(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem({}, { id: 'fingerprint-archive' });
  let revision = 4;
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  t.mock.method(sharePoint, 'getSharePointDriveFolderChildrenWithFields', async () => [
    structuredClone(item),
  ]);
  t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async (_drive: string, _id: string, fields: ProtokollFields, etag?: string) => {
      assert.equal(etag, item.listItem.eTag);
      Object.assign((item.listItem.fields ??= {}), fields);
      item.listItem.eTag = `"item,${++revision}"`;
      item.cTag = `"c:metadata,${revision}"`;
    }
  );
  const send = (body: Record<string, unknown>) =>
    ProtokollTermin(
      request('POST', { ...body, etag: item.listItem.eTag }, { id: item.id, principal: REVIEWER }),
      context
    );
  assert.equal((await send({ action: 'erkennen' })).status, 200);
  const list = await ProtokolleCollection(request('GET'), context);
  const listed = (list.jsonBody as { items: StaffProtokoll[] }).items[0];
  assert.equal(listed.terminStale, false);
  assert.equal((await send({ action: 'bestaetigen', date: '2026-11-04' })).status, 200);
  assert.equal((await send({ action: 'ablehnen' })).status, 200);
  item.cTag = '"c:word-edit,99"';
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () =>
    docx(paragraph('A different meeting'))
  );
  const changed = await ProtokolleCollection(request('GET'), context);
  assert.equal((changed.jsonBody as { items: StaffProtokoll[] }).items[0].terminStale, true);
  assert.equal((await send({ action: 'bestaetigen', date: '2026-11-04' })).status, 400);
});

test('approval and automatic detection survive metadata promotion with the same Word content', async (t) => {
  const context = setup(t);
  withModel(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem(
    { Status: 'Review', ErstelltVon: AUTHOR.userDetails },
    { id: 'fingerprint-approval' }
  );
  let revision = 4;
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async (_drive: string, _id: string, fields: ProtokollFields, etag?: string) => {
      assert.equal(etag, item.listItem.eTag);
      Object.assign((item.listItem.fields ??= {}), fields);
      item.listItem.eTag = `"item,${++revision}"`;
      item.cTag = `"c:metadata,${revision}"`;
    }
  );
  assert.equal(
    (
      await ProtokollItem(
        request('POST', { action: 'approve', etag: ETAG }, { id: item.id, principal: REVIEWER }),
        context
      )
    ).status,
    200
  );
  const resolved = await realContentResolver('drive-1', item);
  const approved = toStaffProtokoll(resolved);
  assert.equal(approved.changedSinceApproval, false);
  assert.equal(approved.terminStale, false);
  assert.equal(approved.termin?.extraction, 'gefunden');
});
