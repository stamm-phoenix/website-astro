import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import {
  ProtokolleCollection,
  ProtokollItem,
  ProtokollTermin,
} from '../endpoints/intern-pflege-protokolle';
import type { ProtokollFields, StaffProtokoll } from '../lib/protokolle';
import { protokollTransition, toStaffProtokoll } from '../lib/protokolle';
import type { ProtokollTermin as StoredTermin } from '../lib/protokoll-termin';
import { parseProtokollTermin, terminWithoutSuggestion } from '../lib/protokoll-termin';
import { docx, paragraph } from './fixtures/docx';
import * as contentVersion from '../lib/protokoll-content-version';
import {
  AUTHOR,
  REVIEWER,
  ETAG,
  driveItem,
  request,
  setupLegacyProtokolle,
  realContentResolver,
} from './fixtures/protokolle';

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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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

test('reopening clears the suggestion, but only where one is stored', (t) => {
  overrideConfig(t, CONFIG.protokolle, { reviewers: [REVIEWER.userDetails] });
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
  withModel(t);
  const update = mockTermin(t, { Status: '', FreigabeVersion: '' }, '"c:{P1},4"');
  const response = await ProtokollTermin(terminRequest({ action: 'erkennen' }), context);
  assert.equal(response.status, 200);
  assert.equal(storedTermin(update, 0)?.sourceVersion, '"c:{P1},4"');
  assert.equal(storedTermin(update, 0)?.extraction, 'gefunden');
});

test('manual entry and rejection work without a previous model call', async (t) => {
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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

test('a zero extraction limit disables the model while approval still validates the Word file', async (t) => {
  const context = setupLegacyProtokolle(t);
  const { file, fetch } = withModel(t);
  CONFIG.protokolle.termin.maxExtractionsPerDay = 0;
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const { item, update } = mockApproval(t);
  item.id = 'zero-limit-real-approval';
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: item.id, principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 200);
  assert.equal(item.listItem.fields.Status, 'Freigegeben');
  assert.equal(update.mock.callCount(), 2);
  assert.equal(storedTermin(update, 1)?.extraction, 'nicht eingerichtet');
  assert.equal(file.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 0);
  t.mock.method(sharePoint, 'getSharePointDriveFolderChildrenWithFields', async () => [item]);
  const listed = await ProtokolleCollection(request('GET'), context);
  assert.equal((listed.jsonBody as { terminConfigured: boolean }).terminConfigured, false);
});

test('automatic detection cannot overwrite a concurrent reviewer decision', async (t) => {
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
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
  const context = setupLegacyProtokolle(t);
  const { file } = withModel(t);
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
  assert.equal(file.mock.callCount(), 2);
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
  const context = setupLegacyProtokolle(t);
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

test('approval leaves the review unchanged when the Word content cannot be validated', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem(
    { Status: 'Review', ErstelltVon: AUTHOR.userDetails },
    { id: 'unreadable-approval' }
  );
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => item);
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => {
    throw new Error('Download unavailable');
  });
  const update = t.mock.method(sharePoint, 'updateSharePointDriveItemFields', async () => {});
  const response = await ProtokollItem(
    request('POST', { action: 'approve', etag: ETAG }, { id: item.id, principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 400);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(item.listItem.fields?.Status, 'Review');
});

test('a legacy approval migrates with its date decision before metadata changes the cTag', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem(
    { Status: 'Freigegeben', FreigabeVersion: APPROVED_VERSION },
    { id: 'legacy-approval' }
  );
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  t.mock.method(
    sharePoint,
    'updateSharePointDriveItemFields',
    async (_drive: string, _id: string, fields: ProtokollFields, etag?: string) => {
      assert.equal(etag, item.listItem.eTag);
      Object.assign((item.listItem.fields ??= {}), fields);
      item.cTag = '"c:metadata,99"';
      item.listItem.eTag = '"item,99"';
    }
  );
  const response = await ProtokollTermin(
    request(
      'POST',
      { action: 'bestaetigen', date: '2026-11-04', etag: ETAG },
      { id: item.id, principal: REVIEWER }
    ),
    context
  );
  assert.equal(response.status, 200);
  const resolved = await realContentResolver('drive-1', item);
  const listed = toStaffProtokoll(resolved);
  assert.equal(listed.changedSinceApproval, false);
  assert.equal(listed.terminStale, false);
  assert.equal(listed.termin?.sourceVersion, item.listItem.fields?.FreigabeVersion);
  assert.match(listed.termin?.sourceVersion ?? '', /^docx-word-sha256:/);
});

test('unreadable archives cannot store or reset a date with a metadata cTag', async (t) => {
  const context = setupLegacyProtokolle(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem({}, { id: 'unreadable-archive' });
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => item);
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => {
    throw new Error('Download unavailable');
  });
  const update = t.mock.method(sharePoint, 'updateSharePointDriveItemFields', async () => {});
  for (const action of ['erkennen', 'bestaetigen', 'ablehnen']) {
    const response = await ProtokollTermin(
      request(
        'POST',
        { action, date: '2026-11-04', etag: ETAG },
        { id: item.id, principal: REVIEWER }
      ),
      context
    );
    assert.equal(response.status, 400);
  }
  assert.equal(update.mock.callCount(), 0);
});

test('recognition rejects a changed content tag even if the list etag has not changed yet', async (t) => {
  const context = setupLegacyProtokolle(t);
  const { file, fetch } = withModel(t);
  t.mock.method(contentVersion, 'withProtokollContentVersion', realContentResolver);
  const item = driveItem({}, { id: 'content-tag-only-race' });
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => structuredClone(item));
  let downloads = 0;
  file.mock.mockImplementation(async () => {
    if (++downloads === 2) item.cTag = 'changed-before-list-item-promotion';
    return WORD_FILE;
  });
  const update = t.mock.method(sharePoint, 'updateSharePointDriveItemFields', async () => {});
  const response = await ProtokollTermin(
    request('POST', { action: 'erkennen', etag: ETAG }, { id: item.id, principal: REVIEWER }),
    context
  );
  assert.equal(response.status, 409);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});
