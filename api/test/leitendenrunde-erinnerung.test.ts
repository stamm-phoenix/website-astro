import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as campflow from '../lib/campflow';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { runLeitendenrundeReminders } from '../lib/leitendenrunde-erinnerung';
import * as reminderMail from '../lib/leitendenrunde-erinnerung-mails';
import { sitzungText } from '../lib/leitendenrunde-erinnerung-mails';
import * as termin from '../lib/leitendenrunde-termin';
import {
  editorSitzung,
  reminderStage,
  sitzungEnd,
  sitzungKey,
  wordSitzung,
  type Sitzung,
} from '../lib/leitendenrunde-termin';
import { runLeitendenrundeWorker } from '../lib/leitendenrunde-worker';
import * as mail from '../lib/mail';
import * as protokollSource from '../lib/protokoll-source';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

const sitzung: Sitzung = {
  ref: 'editor:1',
  date: '2026-10-14',
  time: '19:00',
  place: 'Pfarrheim',
  url: 'https://example.test/p',
};
const stage7 = new Date('2026-10-07T07:00:00Z');
const stage1 = new Date('2026-10-13T07:00:00Z');

function leader(
  email: string | null,
  extra: Record<string, unknown> = {}
): campflow.CampflowPerson {
  return {
    id: `per_${email ?? 'none'}`,
    group_names: ['🐦‍🔥 Leiter*in'],
    primary_email: email,
    join_date: '2020-01-01',
    leave_date: null,
    ...extra,
  };
}

function mockLeaders(t: TestContext, persons: campflow.CampflowPerson[]) {
  return t.mock.method(campflow, 'campflowGetAll', async () => persons);
}

async function approveEditor(
  next: { datum: string; uhrzeit: string; ort: string },
  options: { status?: 'entwurf' | 'review' | 'freigegeben' | 'verschickt'; at?: string } = {}
): Promise<number> {
  const row = await getDb()
    .insertInto('protokoll.protokoll')
    .values({
      title: 'Leitendenrunde',
      meeting_date: '2026-10-07',
      status: options.status ?? 'freigegeben',
      content: JSON.stringify({ naechsteSitzung: next }),
      created_by: 'test',
      updated_by: 'test',
      approved_at: new Date(options.at ?? '2026-10-07T21:00:00Z'),
      approved_by: 'test',
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return row.id;
}
const NEXT = { datum: '2026-10-14', uhrzeit: '19:00', ort: 'Pfarrheim' };

test('stages follow Berlin time through summer, winter and the change between them', () => {
  assert.equal(reminderStage(sitzung, new Date('2026-10-07T06:59:00Z')), null);
  assert.equal(reminderStage(sitzung, stage7), 7);
  assert.equal(reminderStage(sitzung, new Date('2026-10-13T06:59:00Z')), 7);
  assert.equal(reminderStage(sitzung, stage1), 1);
  assert.equal(reminderStage(sitzung, new Date('2026-10-14T16:59:00Z')), 1);
  assert.equal(reminderStage(sitzung, new Date('2026-10-14T17:00:00Z')), null);
  // The clocks go back on 25 October: 9:00 is 07:00 UTC before, 08:00 UTC after.
  const late = { ...sitzung, date: '2026-10-28' };
  assert.equal(reminderStage(late, new Date('2026-10-21T06:59:00Z')), null);
  assert.equal(reminderStage(late, new Date('2026-10-21T07:00:00Z')), 7);
  assert.equal(reminderStage(late, new Date('2026-10-27T07:59:00Z')), 7);
  assert.equal(reminderStage(late, new Date('2026-10-27T08:00:00Z')), 1);
  const winter = { ...sitzung, date: '2026-12-09' };
  assert.equal(reminderStage(winter, new Date('2026-12-02T07:59:00Z')), null);
  assert.equal(reminderStage(winter, new Date('2026-12-02T08:00:00Z')), 7);
});

test('a date confirmed late gets one reminder for the stage that applies, never several', () => {
  assert.equal(reminderStage(sitzung, new Date('2026-10-11T12:00:00Z')), 7);
  assert.equal(reminderStage(sitzung, new Date('2026-10-14T05:00:00Z')), 1);
});

test('without a time the meeting day counts until its end', () => {
  const open = { ...sitzung, time: null };
  assert.equal(sitzungKey(open), '2026-10-14');
  assert.equal(sitzungKey(sitzung), '2026-10-14T19:00');
  assert.equal(sitzungEnd(open).toISOString(), '2026-10-14T21:59:00.000Z');
  assert.equal(reminderStage(open, new Date('2026-10-14T20:00:00Z')), 1);
  assert.equal(reminderStage(open, new Date('2026-10-14T22:00:00Z')), null);
});

test('the editor field is read, invalid dates and times are not', () => {
  const content = (next: unknown) => JSON.stringify({ naechsteSitzung: next });
  assert.deepEqual(editorSitzung(5, content(NEXT)), {
    ref: 'editor:5',
    date: '2026-10-14',
    time: '19:00',
    place: 'Pfarrheim',
    url: `${CONFIG.leitendenrundeReminders.siteUrl}/leitendenbereich/protokolle/protokoll?id=5`,
  });
  assert.equal(editorSitzung(5, content({ datum: '', uhrzeit: '', ort: '' })), null);
  assert.equal(editorSitzung(5, content({ datum: '2026-02-31', uhrzeit: '', ort: '' })), null);
  assert.equal(
    editorSitzung(5, content({ datum: '2026-10-14', uhrzeit: '25:00', ort: ' ' }))?.time,
    null
  );
  assert.equal(
    editorSitzung(5, content({ datum: '2026-10-14', uhrzeit: '', ort: ' ' }))?.place,
    null
  );
  assert.equal(editorSitzung(5, 'not json'), null);
});

test('Word minutes count only with a confirmed date of the approved version', () => {
  const stored = (decision: string, version = 'v1') =>
    JSON.stringify({
      sourceVersion: version,
      extraction: 'gefunden',
      suggestion: { date: '2026-10-14', time: '19:00', place: null, quote: 'am 14.10.' },
      decision,
      confirmed:
        decision === 'bestaetigt' ? { date: '2026-10-14', time: '19:00', place: null } : null,
      decidedBy: 'x',
      decidedAt: '',
      extractedAt: '',
    });
  const fields = (decision: string, version?: string) => ({
    Status: 'Freigegeben',
    FreigabeVersion: 'v1',
    Termin: stored(decision, version),
  });
  assert.equal(wordSitzung('abc', fields('bestaetigt'))?.date, '2026-10-14');
  assert.equal(wordSitzung('abc', fields('offen')), null);
  assert.equal(wordSitzung('abc', fields('abgelehnt')), null);
  assert.equal(wordSitzung('abc', fields('bestaetigt', 'v0')), null);
  assert.equal(wordSitzung('abc', { Status: 'Freigegeben' }), null);
});

test('the mail text names day, time and place and escapes the place', async (t) => {
  assert.equal(sitzungText(sitzung), 'Mittwoch, 14.10.2026, 19:00 Uhr, Ort: Pfarrheim');
  assert.equal(sitzungText({ ...sitzung, time: null, place: null }), 'Mittwoch, 14.10.2026');
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  await reminderMail.sendLeitendenrundeReminder('lea@example.test', {
    ...sitzung,
    place: '<script>x</script>',
  });
  const args = send.mock.calls[0].arguments;
  assert.equal(args[0], 'lea@example.test');
  assert.equal(args[1], 'Erinnerung: Leitendenrunde am 14.10.2026');
  assert.match(args[2]!, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(args[2]!, /https:\/\/example\.test\/p/);
  assert.equal(args[3], CONFIG.leitendenrundeReminders.sender);
  assert.deepEqual(args[5], {
    retry: false,
    timeoutMs: CONFIG.leitendenrundeReminders.mailTimeoutMs,
  });
});

test('previews stop before reading minutes, CampFlow or sending', async (t) => {
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  const read = t.mock.method(termin, 'currentSitzung', async () => sitzung);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'preview');
  await assert.rejects(reminderMail.sendLeitendenrundeReminder('lea@example.test', sitzung));
  assert.equal(read.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});

dbTest('concurrent and repeated runs send each leader one reminder per stage', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [
    leader('lea@example.test'),
    leader('Max@Example.test'),
    leader('max@example.test', { id: 'per_second' }),
    leader('alt@example.test', { leave_date: '2026-01-01' }),
    leader('kind@example.test', { group_names: ['Wölflinge'] }),
    leader(null),
  ]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const results = await Promise.all([
    runLeitendenrundeReminders(stage7),
    runLeitendenrundeReminders(stage7),
  ]);
  assert.equal(send.mock.callCount(), 2);
  assert.equal(results[0].sent + results[1].sent, 2);
  assert.equal(results[0].missingAddress, 1);
  assert.deepEqual(send.mock.calls.map((call) => call.arguments[0]).sort(), [
    'lea@example.test',
    'max@example.test',
  ]);
  assert.equal((await runLeitendenrundeReminders(stage7)).sent, 0);
  assert.equal((await runLeitendenrundeReminders(new Date('2026-10-10T10:00:00Z'))).sent, 0);
  assert.equal(send.mock.callCount(), 2);
  assert.equal((await runLeitendenrundeReminders(stage1)).sent, 2);
  assert.equal(send.mock.callCount(), 4);
  const rows = await getDb().selectFrom('protokoll.erinnerung').selectAll().execute();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.status === 'sent' && row.meeting_key === '2026-10-14T19:00'));
  // Addresses are not stored, only their hash.
  assert.ok(rows.every((row) => !JSON.stringify(row).includes('example.test')));
});

dbTest('drafts, minutes in review, past dates and missing dates send nothing', async (t) => {
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const read = mockLeaders(t, [leader('lea@example.test')]);
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'no-meeting');
  await approveEditor(NEXT, { status: 'entwurf' });
  await approveEditor(NEXT, { status: 'review' });
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'no-meeting');
  const approved = await approveEditor(NEXT, { at: '2026-10-07T22:00:00Z' });
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-06T10:00:00Z'))).reason,
    'no-stage'
  );
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-15T10:00:00Z'))).reason,
    'no-stage'
  );
  assert.equal(send.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);
  // The newest approved minutes decide: without a date there is nothing, older dates stay out.
  await getDb()
    .updateTable('protokoll.protokoll')
    .set({ content: JSON.stringify({ naechsteSitzung: { datum: '', uhrzeit: '', ort: '' } }) })
    .where('id', '=', approved)
    .execute();
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'no-meeting');
  assert.equal(send.mock.callCount(), 0);
});

dbTest('a changed date gets its own reminders and a cancellation stops them', async (t) => {
  const id = await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  await runLeitendenrundeReminders(stage7);
  assert.equal(send.mock.callCount(), 1);
  const move = (next: { datum: string; uhrzeit: string; ort: string }) =>
    getDb()
      .updateTable('protokoll.protokoll')
      .set({ content: JSON.stringify({ naechsteSitzung: next }) })
      .where('id', '=', id)
      .execute();
  await move({ ...NEXT, datum: '2026-10-21' });
  assert.equal((await runLeitendenrundeReminders(stage1)).reason, 'no-stage');
  assert.equal((await runLeitendenrundeReminders(new Date('2026-10-14T07:00:00Z'))).sent, 1);
  assert.equal(send.mock.callCount(), 2);
  await move({ datum: '', uhrzeit: '', ort: '' });
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-20T07:00:00Z'))).reason,
    'no-meeting'
  );
  assert.equal(send.mock.callCount(), 2);
});

dbTest('a date changed between the plan and the mail drops the reservation', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const real = termin.currentSitzung;
  let calls = 0;
  t.mock.method(termin, 'currentSitzung', async () => (++calls === 1 ? real() : null));
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'changed');
  assert.equal(send.mock.callCount(), 0);
  assert.equal((await getDb().selectFrom('protokoll.erinnerung').selectAll().execute()).length, 0);
});

dbTest('confirmed Word minutes count, suggestions do not', async (t) => {
  const word = (decision: 'bestaetigt' | 'offen', itemId: string, approvedAt: string) =>
    getDb()
      .insertInto('organisation.protokoll')
      .values({
        drive_id: 'drive',
        item_id: itemId,
        legacy_fields: null,
        legacy_etag: null,
        fields: JSON.stringify({
          Status: 'Freigegeben',
          FreigegebenAm: approvedAt,
          FreigabeVersion: 'v1',
          Termin: JSON.stringify({
            sourceVersion: 'v1',
            extraction: 'gefunden',
            suggestion: { date: '2026-10-14', time: '19:00', place: null, quote: 'x' },
            decision,
            confirmed:
              decision === 'bestaetigt' ? { date: '2026-10-14', time: '19:00', place: null } : null,
            decidedBy: 'x',
            decidedAt: '',
            extractedAt: '',
          }),
        }),
      })
      .execute();
  mockLeaders(t, [leader('lea@example.test')]);
  type Loaded = Awaited<ReturnType<typeof protokollSource.loadProtokoll>>;
  const loaded = (changed = false, stale = false): Loaded =>
    ({
      item: {},
      protokoll: { changedSinceApproval: changed, terminStale: stale },
    }) as unknown as Loaded;
  const files = t.mock.method(protokollSource, 'loadProtokoll', async () => loaded());
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  await word('offen', 'a', '2026-10-07T21:00:00Z');
  assert.equal((await runLeitendenrundeReminders(stage7)).reason, 'no-meeting');
  await word('bestaetigt', 'b', '2026-10-08T21:00:00Z');
  assert.equal((await runLeitendenrundeReminders(new Date('2026-10-09T07:00:00Z'))).sent, 1);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(send.mock.calls[0].arguments[1]?.url.endsWith('/leitendenbereich/protokolle'), true);
  // A file changed after the approval, or a date from another version, gives no date at all.
  files.mock.mockImplementation(async () => loaded(true));
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-13T07:00:00Z'))).reason,
    'no-meeting'
  );
  files.mock.mockImplementation(async () => loaded(false, true));
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-13T07:00:00Z'))).reason,
    'no-meeting'
  );
  // Deleted minutes (the row stays for a restore) send no more; a failing check stops the run.
  files.mock.mockImplementation(async () => undefined);
  assert.equal(
    (await runLeitendenrundeReminders(new Date('2026-10-13T07:00:00Z'))).reason,
    'no-meeting'
  );
  files.mock.mockImplementation(async () => {
    throw new Error('Graph unavailable');
  });
  await assert.rejects(runLeitendenrundeReminders(new Date('2026-10-13T07:00:00Z')), /Graph/);
  assert.equal(send.mock.callCount(), 1);
});

dbTest('no mail goes out once the meeting has begun during the run', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('a@example.test'), leader('b@example.test')]);
  const start = new Date('2026-10-14T16:47:00Z');
  let later = false;
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => {
    later = true;
  });
  const result = await runLeitendenrundeReminders(start, {
    clock: () => (later ? new Date('2026-10-14T17:01:00Z') : start),
  });
  assert.equal(result.reason, 'changed');
  assert.equal(result.sent, 1);
  assert.equal(send.mock.callCount(), 1);
  const rows = await getDb().selectFrom('protokoll.erinnerung').select('status').execute();
  assert.deepEqual(
    rows.map((row) => row.status),
    ['sent']
  );
});

dbTest('the mail carries the values found just before sending', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const real = termin.currentSitzung;
  let calls = 0;
  t.mock.method(termin, 'currentSitzung', async () => {
    const found = await real();
    return ++calls === 1 || !found ? found : { ...found, place: 'Neuer Ort', ref: 'editor:99' };
  });
  assert.equal((await runLeitendenrundeReminders(stage7)).sent, 1);
  assert.equal(send.mock.calls[0].arguments[1]?.place, 'Neuer Ort');
});

dbTest('a failing check before sending frees the reservation for the next run', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const real = termin.currentSitzung;
  let calls = 0;
  // The first look plans the run, the second is the check before the mail.
  t.mock.method(termin, 'currentSitzung', async () => {
    if (++calls === 2) throw new Error('Graph unavailable');
    return real();
  });
  await assert.rejects(runLeitendenrundeReminders(stage7), /Graph unavailable/);
  assert.equal(send.mock.callCount(), 0);
  assert.equal((await getDb().selectFrom('protokoll.erinnerung').selectAll().execute()).length, 0);
  assert.equal((await runLeitendenrundeReminders(stage7)).sent, 1);
});

dbTest(
  'the pause after throttling counts from the moment of the answer, not the run start',
  async (t) => {
    await approveEditor(NEXT);
    mockLeaders(t, [leader('lea@example.test')]);
    let answered = false;
    t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => {
      answered = true;
      throw Object.assign(new Error('Too many requests'), { statusCode: 429 });
    });
    const late = new Date(stage7.getTime() + 7 * 60_000);
    await runLeitendenrundeReminders(stage7, { clock: () => (answered ? late : stage7) });
    const row = await getDb()
      .selectFrom('protokoll.erinnerung')
      .select(['status', 'retry_after'])
      .executeTakeFirstOrThrow();
    assert.equal(row.status, 'retryable');
    assert.equal(new Date(row.retry_after as Date).getTime(), late.getTime() + 45 * 60_000);
  }
);

dbTest('an unclear result stays reserved, throttling is retried after the pause', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => {
    throw new Error('Connection lost after submit');
  });
  assert.equal((await runLeitendenrundeReminders(stage7)).uncertain, 1);
  assert.equal((await runLeitendenrundeReminders(stage7)).uncertain, 0);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(
    (await getDb().selectFrom('protokoll.erinnerung').select('status').executeTakeFirstOrThrow())
      .status,
    'uncertain'
  );
  await getDb().deleteFrom('protokoll.erinnerung').execute();
  let attempt = 0;
  send.mock.mockImplementation(async () => {
    if (++attempt === 1) throw Object.assign(new Error('Too many requests'), { statusCode: 429 });
  });
  assert.equal((await runLeitendenrundeReminders(stage7)).retryable, 1);
  assert.equal(
    (await runLeitendenrundeReminders(new Date(stage7.getTime() + 10 * 60_000))).sent,
    0
  );
  assert.equal(
    (await runLeitendenrundeReminders(new Date(stage7.getTime() + 50 * 60_000))).sent,
    1
  );
  assert.equal(attempt, 2);
  // A rejected request is final.
  await getDb().deleteFrom('protokoll.erinnerung').execute();
  send.mock.mockImplementation(async () => {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  });
  assert.equal((await runLeitendenrundeReminders(stage7)).failed, 1);
});

dbTest('reservations that were abandoned are reported once and old rows are removed', async (t) => {
  await approveEditor(NEXT);
  mockLeaders(t, [leader('lea@example.test')]);
  t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const row = (key: string, date: string, status: 'attempted' | 'sent', hash: string) => ({
    meeting_key: key,
    meeting_date: date,
    meeting_at: new Date(`${date}T17:00:00Z`),
    protokoll_ref: 'editor:1',
    days_before: 7,
    recipient_hash: hash,
    status,
    attempted_at: new Date('2026-10-07T06:00:00Z'),
  });
  await getDb()
    .insertInto('protokoll.erinnerung')
    .values([
      row('2026-10-14T19:00', '2026-10-14', 'attempted', 'a'.repeat(64)),
      row('2025-01-01', '2025-01-01', 'sent', 'b'.repeat(64)),
    ])
    .execute();
  const result = await runLeitendenrundeReminders(stage7);
  assert.equal(result.uncertain, 1);
  assert.equal(result.sent, 1);
  const rows = await getDb().selectFrom('protokoll.erinnerung').select('meeting_key').execute();
  assert.ok(!rows.some((entry) => entry.meeting_key === '2025-01-01'));
  assert.equal((await runLeitendenrundeReminders(stage7)).uncertain, 0);
});

dbTest(
  'the run limit leaves the rest for the next run, CampFlow errors send nothing',
  async (t) => {
    await approveEditor(NEXT);
    const persons = [leader('a@example.test'), leader('b@example.test'), leader('c@example.test')];
    const read = mockLeaders(t, persons);
    overrideConfig(t, CONFIG.leitendenrundeReminders, { maxMailsPerRun: 2 });
    const send = t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
    assert.equal((await runLeitendenrundeReminders(stage7)).remaining, 1);
    assert.equal((await runLeitendenrundeReminders(stage7)).remaining, 0);
    assert.equal(send.mock.callCount(), 3);
    await getDb().deleteFrom('protokoll.erinnerung').execute();
    read.mock.mockImplementation(async () => {
      throw new campflow.CampflowError(503, 'down');
    });
    await assert.rejects(runLeitendenrundeReminders(stage7), /down/);
    assert.equal(send.mock.callCount(), 3);
    assert.equal(
      (await getDb().selectFrom('protokoll.erinnerung').selectAll().execute()).length,
      0
    );
  }
);

dbTest('the worker fails when something needs a look and reports every run', async (t) => {
  await approveEditor(NEXT);
  const read = mockLeaders(t, [leader('lea@example.test'), leader(null)]);
  t.mock.method(reminderMail, 'sendLeitendenrundeReminder', async () => undefined);
  const reports: unknown[] = [];
  await assert.rejects(
    runLeitendenrundeWorker((result) => reports.push(result), stage7),
    /missingAddress=1/
  );
  assert.equal(reports.length, 1);
  read.mock.mockImplementation(async () => [leader('lea@example.test')]);
  await runLeitendenrundeWorker((result) => reports.push(result), stage1);
  assert.equal(reports.length, 2);
});
