import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reminderClock,
  reminderFailureOutcome,
  taskReminderGroups,
  runTaskReminders,
} from '../lib/aufgaben-erinnerungen';
import * as reminderMail from '../lib/aufgaben-erinnerung-mails';
import * as mail from '../lib/mail';
import * as tasks from '../lib/aufgaben';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
import type { Task } from '../lib/aufgaben-model';

const day = '2026-10-12';
const now = new Date('2026-10-12T07:17:00Z');
const alex = { name: 'Alex Beispiel', login: 'alex.beispiel@stamm-phoenix.de' };
const bea = { name: 'Bea Beispiel', login: 'bea.beispiel@stamm-phoenix.de' };
const input = {
  title: 'Zelte prüfen',
  description: '',
  assignee: alex.login,
  assignees: [alex, bea],
  dueDate: day,
  projectId: null,
};
const task: Task = {
  ...input,
  id: 1,
  etag: '"0000000000000001"',
  state: 'offen',
  quote: '',
  sourceId: '',
  sourceVersion: '',
};

test('reminder dates and start time use Berlin, including summer, winter and midnight', () => {
  assert.deepEqual(reminderClock(new Date('2026-10-11T22:30:00Z')), { day, hour: 0 });
  assert.equal(reminderClock(new Date('2026-07-10T07:17:00Z')).hour, 9);
  assert.equal(reminderClock(new Date('2026-12-10T08:17:00Z')).hour, 9);
});
test('only due/tomorrow open tasks go once to every assigned internal login', () => {
  const rows: Task[] = [
    task,
    { ...task, id: 2, dueDate: '2026-10-13' },
    { ...task, id: 3, dueDate: '2026-10-11' },
    { ...task, id: 4, dueDate: '2026-10-14' },
    { ...task, id: 5, dueDate: null },
    { ...task, id: 6, state: 'erledigt' },
    { ...task, id: 7, state: 'vorschlag' },
    { ...task, id: 8, state: 'abgelehnt' },
    { ...task, id: 9, assignees: [{ name: 'Alex', login: '' }] },
    { ...task, id: 12, assignees: [{ name: 'Alex Beispiel', login: '' }] },
    { ...task, id: 13, assignee: 'Bea Beispiel', assignees: undefined },
    { ...task, id: 10, assignees: [{ name: 'Extern', login: 'extern@example.test' }] },
    { ...task, id: 11, assignees: [alex, { ...alex, login: alex.login.toUpperCase() }] },
  ];
  const groups = taskReminderGroups(rows, day);
  assert.deepEqual([...groups.keys()], [alex.login, bea.login]);
  assert.deepEqual(
    groups.get(alex.login)?.map((row) => row.id),
    [1, 2, 11]
  );
  assert.deepEqual(
    groups.get(bea.login)?.map((row) => row.id),
    [1, 2]
  );
});
test('preview and pre-9AM runs stop before loading tasks or sending mail', async (t) => {
  const read = t.mock.method(tasks, 'getTasks', async () => [task]);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  assert.equal((await runTaskReminders(now)).reason, 'preview');
  await assert.rejects(reminderMail.sendTaskReminderMail(alex.login, [task], [], day));
  assert.equal(read.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});
test('before-window runs do no database work', async (t) => {
  const read = t.mock.method(tasks, 'getTasks', async () => [task]);
  assert.equal((await runTaskReminders(new Date('2026-10-12T06:59:00Z'))).reason, 'before-window');
  assert.equal(read.mock.callCount(), 0);
});
test('reminder HTML escapes titles and projects, uses private mail, dates and app links without transport retries', async (t) => {
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  await reminderMail.sendTaskReminderMail(
    alex.login,
    [{ ...task, title: '<script>x</script>', projectId: 7 }],
    [{ id: 7, etag: '', title: 'Lager & <Spaß>', campflowId: '' }],
    day
  );
  const args = send.mock.calls[0].arguments;
  assert.equal(args[0], alex.login);
  assert.equal(args[1], 'Erinnerung: 1 Aufgabe');
  assert.match(args[2]!, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(args[2]!, /Lager &amp; &lt;Spaß&gt;/);
  assert.match(args[2]!, /Heute fällig · 12.10.2026/);
  assert.match(args[2]!, /leitendenbereich\/aufgaben#aufgabe-1/);
  assert.ok(!args[2]!.includes(bea.login));
  assert.deepEqual(args[5], { retry: false, timeoutMs: CONFIG.taskReminders.mailTimeoutMs });
});

dbTest(
  'concurrent and repeated reminder workers send one summary per person and day',
  async (t) => {
    await tasks.createTask(input, 'test');
    await tasks.createTask({ ...input, title: 'Küche planen', dueDate: '2026-10-13' }, 'test');
    const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => undefined);
    await Promise.all([runTaskReminders(now), runTaskReminders(now)]);
    assert.equal(send.mock.callCount(), 2);
    assert.deepEqual(
      new Set(send.mock.calls.map((call) => call.arguments[0])),
      new Set([alex.login, bea.login])
    );
    assert.ok(send.mock.calls.every((call) => call.arguments[1]?.length === 2));
    await runTaskReminders(now);
    assert.equal(send.mock.callCount(), 2);
    const rows = await getDb()
      .selectFrom('organisation.task_reminder_delivery')
      .selectAll()
      .execute();
    assert.ok(rows.every((row) => row.status === 'sent'));
    assert.equal(rows.length, 2);
  }
);
dbTest('ambiguous transport failures remain reserved and are not retried', async (t) => {
  await tasks.createTask({ ...input, assignees: [alex] }, 'test');
  const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => {
    throw new Error('Connection lost after submit');
  });
  assert.equal((await runTaskReminders(now)).uncertain, 1);
  assert.equal((await runTaskReminders(now)).uncertain, 0);
  assert.equal(send.mock.callCount(), 1);
  const row = await getDb()
    .selectFrom('organisation.task_reminder_delivery')
    .selectAll()
    .executeTakeFirstOrThrow();
  assert.equal(row.status, 'uncertain');
});
dbTest(
  'batch limits leave unsent people for the next call, next day has its own reservation',
  async (t) => {
    overrideConfig(t, CONFIG.taskReminders, { batchSize: 1 });
    await tasks.createTask({ ...input, dueDate: '2026-10-13' }, 'test');
    const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => undefined);
    assert.equal((await runTaskReminders(now)).remaining, 1);
    assert.equal((await runTaskReminders(now)).remaining, 0);
    assert.equal(send.mock.callCount(), 2);
    await runTaskReminders(new Date('2026-10-13T07:17:00Z'));
    await runTaskReminders(new Date('2026-10-13T07:17:00Z'));
    assert.equal(send.mock.callCount(), 4);
  }
);
dbTest(
  'completion or reassignment between selection and transport suppresses obsolete reminders',
  async (t) => {
    await tasks.createTask({ ...input, assignees: [alex] }, 'test');
    const saved = await tasks.getTasks();
    let calls = 0;
    t.mock.method(tasks, 'getTasks', async () =>
      ++calls === 1 ? saved : saved.map((task) => ({ ...task, state: 'erledigt' as const }))
    );
    const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => undefined);
    await runTaskReminders(now);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(
      (await getDb().selectFrom('organisation.task_reminder_delivery').selectAll().execute())
        .length,
      0
    );
  }
);
dbTest(
  'a persisted attempted delivery is not resent after a process restart; old receipts expire',
  async (t) => {
    await tasks.createTask({ ...input, assignees: [alex] }, 'test');
    await getDb()
      .insertInto('organisation.task_reminder_delivery')
      .values([
        { reminder_day: day, recipient: alex.login, status: 'attempted', sent_at: null },
        {
          reminder_day: '2026-01-01',
          recipient: bea.login,
          status: 'sent',
          sent_at: new Date('2026-01-01T08:00:00Z'),
        },
      ])
      .execute();
    const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => undefined);
    assert.equal((await runTaskReminders(now)).uncertain, 0);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(
      (await getDb().selectFrom('organisation.task_reminder_delivery').selectAll().execute())
        .length,
      1
    );
  }
);

for (const [status, expected] of [
  [400, 'failed'],
  [401, 'failed'],
  [403, 'failed'],
  [408, 'uncertain'],
  [429, 'retryable'],
  [500, 'uncertain'],
  [502, 'uncertain'],
  [503, 'uncertain'],
  [504, 'uncertain'],
  [-1, 'uncertain'],
  [undefined, 'uncertain'],
] as const) {
  test(`reminder transport ${status} is ${expected}`, () =>
    assert.equal(reminderFailureOutcome(status), expected));
}
dbTest(
  'throttling defers only that recipient, drains later batches and retries next hour',
  async (t) => {
    overrideConfig(t, CONFIG.taskReminders, { batchSize: 1 });
    await tasks.createTask(input, 'test');
    const recipients: string[] = [];
    t.mock.method(reminderMail, 'sendTaskReminderMail', async (recipient: string) => {
      recipients.push(recipient);
      if (recipients.length === 1) throw Object.assign(new Error('Throttled'), { statusCode: 429 });
    });
    const first = await runTaskReminders(now);
    assert.equal(first.retryable, 1);
    assert.equal(first.remaining, 1);
    assert.equal((await runTaskReminders(now)).sent, 1);
    assert.equal((await runTaskReminders(now)).sent, 0);
    assert.deepEqual(recipients, [alex.login, bea.login]);
    assert.equal((await runTaskReminders(new Date(now.getTime() + 3600000))).sent, 1);
    assert.deepEqual(recipients, [alex.login, bea.login, alex.login]);
  }
);
for (const statusCode of [400, 403, 408, 500, 502, 503, 504]) {
  dbTest(`HTTP ${statusCode} remains reserved and is reported only once`, async (t) => {
    await tasks.createTask({ ...input, assignees: [alex] }, 'test');
    const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => {
      throw Object.assign(new Error('Transport error'), { statusCode });
    });
    const first = await runTaskReminders(now);
    assert.equal(first[statusCode < 408 ? 'failed' : 'uncertain'], 1);
    const second = await runTaskReminders(new Date(now.getTime() + 3600000));
    assert.equal(second.failed + second.uncertain + second.retryable, 0);
    assert.equal(send.mock.callCount(), 1);
  });
}
dbTest('abandoned attempts are reported once while fresh attempts remain in flight', async (t) => {
  await getDb()
    .insertInto('organisation.task_reminder_delivery')
    .values([
      {
        reminder_day: day,
        recipient: alex.login,
        status: 'attempted',
        attempted_at: new Date(now.getTime() - 360000),
        sent_at: null,
      },
      {
        reminder_day: day,
        recipient: bea.login,
        status: 'attempted',
        attempted_at: now,
        sent_at: null,
      },
    ])
    .execute();
  const send = t.mock.method(reminderMail, 'sendTaskReminderMail', async () => undefined);
  assert.equal((await runTaskReminders(now)).uncertain, 1);
  assert.equal((await runTaskReminders(now)).uncertain, 0);
  assert.equal(send.mock.callCount(), 0);
});
