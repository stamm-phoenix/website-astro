import assert from 'node:assert/strict';
import test from 'node:test';
import { InvocationContext } from '@azure/functions';
import * as reminders from '../lib/aufgaben-erinnerungen';
import * as worker from '../lib/task-reminder-worker';
import { CONFIG } from '../lib/config';
import { runTaskReminderWorker } from '../lib/task-reminder-worker';
import { taskReminderTimer } from '../timers/task-reminders';
function result(patch: Partial<reminders.ReminderResult> = {}): reminders.ReminderResult {
  return {
    day: '2026-10-13',
    sent: 0,
    uncertain: 0,
    remaining: 0,
    retryable: 0,
    failed: 0,
    ...patch,
  };
}
test('Azure worker drains batches and reports only outcome counters', async (t) => {
  const now = new Date('2026-10-13T07:17:00Z');
  const calls: Date[] = [];
  t.mock.method(reminders, 'runTaskReminders', async (date: Date) => {
    calls.push(date);
    return result({ sent: 2, remaining: calls.length === 1 ? 1 : 0 });
  });
  const reports: reminders.ReminderResult[] = [];
  await runTaskReminderWorker((value) => reports.push(value), now);
  assert.deepEqual(calls, [now, now]);
  assert.equal(reports.length, 2);
});
for (const outcome of ['failed', 'uncertain', 'retryable'] as const) {
  test(`Azure worker reports ${outcome} after finishing the remaining recipients`, async (t) => {
    let calls = 0;
    t.mock.method(reminders, 'runTaskReminders', async () =>
      ++calls === 1 ? result({ [outcome]: 1, remaining: 1 }) : result({ sent: 1 })
    );
    await assert.rejects(
      runTaskReminderWorker(() => {}),
      new RegExp(`${outcome}=1`)
    );
    assert.equal(calls, 2);
  });
}
test('Azure worker bounds the backlog to the configured batch count', async (t) => {
  const run = t.mock.method(reminders, 'runTaskReminders', async () => result({ remaining: 1 }));
  await assert.rejects(
    runTaskReminderWorker(() => {}),
    /remaining=1/
  );
  assert.equal(run.mock.callCount(), CONFIG.taskReminders.maxBatches);
});
test('timer stays disabled until explicitly enabled; exceptions reveal no transport details', async (t) => {
  const original = process.env.TASK_REMINDERS_ENABLED;
  t.after(() => {
    if (original === undefined) delete process.env.TASK_REMINDERS_ENABLED;
    else process.env.TASK_REMINDERS_ENABLED = original;
  });
  const run = t.mock.method(worker, 'runTaskReminderWorker', async () => {
    throw new Error('private transport detail');
  });
  const context = new InvocationContext({ functionName: 'timer-test' });
  t.mock.method(context, 'log', () => {});
  const errors: unknown[][] = [];
  t.mock.method(context, 'error', (...args: unknown[]) => errors.push(args));
  delete process.env.TASK_REMINDERS_ENABLED;
  await taskReminderTimer(
    {
      isPastDue: false,
      schedule: { adjustForDST: false },
      scheduleStatus: { last: '', next: '', lastUpdated: '' },
    },
    context
  );
  assert.equal(run.mock.callCount(), 0);
  process.env.TASK_REMINDERS_ENABLED = 'true';
  await assert.rejects(
    taskReminderTimer(
      {
        isPastDue: false,
        schedule: { adjustForDST: false },
        scheduleStatus: { last: '', next: '', lastUpdated: '' },
      },
      context
    ),
    /execution failed/
  );
  assert.ok(!JSON.stringify(errors).includes('private transport detail'));
});
