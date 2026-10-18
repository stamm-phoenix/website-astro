import { berlinDay } from './calendar-day';
import { createHash } from 'node:crypto';
import { CONFIG } from './config';
import { getTasks } from './aufgaben';
import { taskPeople } from './aufgaben-zuordnung';
import type { Task } from './aufgaben-model';
import {
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toVersion,
  VersionConflictError,
} from './db';
import { sendTaskReminderMail, taskReminderMailAllowed } from './aufgaben-erinnerung-mails';

export interface ReminderResult {
  day: string;
  sent: number;
  uncertain: number;
  remaining: number;
  retryable: number;
  failed: number;
  reason?: 'preview' | 'before-window';
}
interface Reservation {
  id: number;
  etag: string;
}

/** Only throttling is safely retryable; gateways may fail after accepting a message. */
export function reminderFailureOutcome(
  statusCode: number | undefined
): 'retryable' | 'failed' | 'uncertain' {
  if (statusCode === 429) return 'retryable';
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 408)
    return 'failed';
  return 'uncertain';
}

export function reminderClock(now: Date): { day: string; hour: number } {
  return {
    day: berlinDay(now),
    hour: Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(now)
    ),
  };
}
function offsetDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Only open tasks, today's configured due dates and actual stored/internal logins qualify. */
export function taskReminderGroups(tasks: Task[], day: string): Map<string, Task[]> {
  const dates = new Set(CONFIG.taskReminders.daysBefore.map((offset) => offsetDay(day, offset)));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.state !== 'offen' || !task.dueDate || !dates.has(task.dueDate)) continue;
    for (const person of taskPeople(task)) {
      const recipient = person.login.trim().toLowerCase();
      if (!/^[^\s@]+@stamm-phoenix\.de$/.test(recipient)) continue;
      const group = groups.get(recipient) ?? [];
      if (!group.some((entry) => entry.id === task.id)) group.push(task);
      groups.set(recipient, group);
    }
  }
  return groups;
}

async function reserve(day: string, recipient: string, now: Date): Promise<Reservation | null> {
  return inTransaction(async (trx) => {
    await lockResource(
      trx,
      `task-reminder:${day}:${createHash('sha256').update(recipient).digest('hex')}`
    );
    const exists = await trx
      .selectFrom('organisation.task_reminder_delivery')
      .select(['id', 'status', 'retry_after'])
      .where('reminder_day', '=', day)
      .where('recipient', '=', recipient)
      .executeTakeFirst();
    if (exists) {
      if (exists.status !== 'retryable' || !exists.retry_after || exists.retry_after > now)
        return null;
      const row = await trx
        .updateTable('organisation.task_reminder_delivery')
        .set({ status: 'attempted', attempted_at: now, retry_after: null })
        .where('id', '=', exists.id)
        .output(['inserted.id', 'inserted.version'])
        .executeTakeFirstOrThrow();
      return { id: row.id, etag: toVersion(row.version) };
    }
    const row = await trx
      .insertInto('organisation.task_reminder_delivery')
      .values({
        reminder_day: day,
        recipient,
        status: 'attempted',
        attempted_at: now,
        sent_at: null,
      })
      .output(['inserted.id', 'inserted.version'])
      .executeTakeFirstOrThrow();
    return { id: row.id, etag: toVersion(row.version) };
  });
}
async function release(reservation: Reservation): Promise<void> {
  await getDb()
    .deleteFrom('organisation.task_reminder_delivery')
    .where('id', '=', reservation.id)
    .where('version', '=', requireVersion(reservation.etag))
    .where('status', '=', 'attempted')
    .execute();
}

async function record(
  reservation: Reservation,
  status: 'sent' | 'uncertain' | 'failed' | 'retryable',
  now: Date
): Promise<void> {
  const row = await getDb()
    .updateTable('organisation.task_reminder_delivery')
    .set({
      status,
      sent_at: status === 'sent' ? now : null,
      retry_after: status === 'retryable' ? new Date(now.getTime() + 45 * 60 * 1000) : null,
    })
    .where('id', '=', reservation.id)
    .where('version', '=', requireVersion(reservation.etag))
    .where('status', '=', 'attempted')
    .output('inserted.id')
    .executeTakeFirst();
  if (!row) throw new VersionConflictError();
}

/** Persist before transport; a crash or ambiguous Graph error must never trigger automatic resends. */
export async function runTaskReminders(now = new Date()): Promise<ReminderResult> {
  const { day, hour } = reminderClock(now);
  const result: ReminderResult = {
    day,
    sent: 0,
    uncertain: 0,
    remaining: 0,
    retryable: 0,
    failed: 0,
  };
  if (!taskReminderMailAllowed()) return { ...result, reason: 'preview' };
  if (hour < CONFIG.taskReminders.startHour) return { ...result, reason: 'before-window' };
  await getDb()
    .deleteFrom('organisation.task_reminder_delivery')
    .where('reminder_day', '<', offsetDay(day, -CONFIG.taskReminders.retentionDays))
    .execute();
  // Atomically report abandoned reservations once; never resend an ambiguous attempt.
  const abandoned = await getDb()
    .updateTable('organisation.task_reminder_delivery')
    .set({ status: 'uncertain' })
    .where('status', '=', 'attempted')
    .where('attempted_at', '<', new Date(now.getTime() - 5 * 60 * 1000))
    .output('inserted.id')
    .execute();
  result.uncertain += abandoned.length;
  // Throttled deliveries from a closed Berlin day cannot be retried for that day.
  const expiredRetries = await getDb()
    .updateTable('organisation.task_reminder_delivery')
    .set({ status: 'failed', retry_after: null })
    .where('status', '=', 'retryable')
    .where('reminder_day', '<', day)
    .output('inserted.id')
    .execute();
  result.failed += expiredRetries.length;
  const filter = {
    state: 'offen' as const,
    dueDates: CONFIG.taskReminders.daysBefore.map((offset) => offsetDay(day, offset)),
  };
  const groups = taskReminderGroups(await getTasks(filter), day);
  const previous = await getDb()
    .selectFrom('organisation.task_reminder_delivery')
    .select(['recipient', 'status', 'retry_after'])
    .where('reminder_day', '=', day)
    .execute();
  const attempted = new Set(
    previous
      .filter(
        (entry) => entry.status !== 'retryable' || !entry.retry_after || entry.retry_after > now
      )
      .map((entry) => entry.recipient)
  );
  let processed = 0;
  for (const recipient of [...groups.keys()].sort()) {
    if (attempted.has(recipient)) continue;
    if (processed >= CONFIG.taskReminders.batchSize) break;
    const reservation = await reserve(day, recipient, now);
    attempted.add(recipient);
    if (!reservation) continue;
    processed++;
    // Completion, reassignment or deadline changes before transport suppress obsolete reminders.
    const tasks = taskReminderGroups(await getTasks(filter), day).get(recipient) ?? [];
    if (!tasks.length) {
      await release(reservation);
      continue;
    }
    try {
      await sendTaskReminderMail(recipient, tasks, day);
    } catch (error) {
      const statusCode =
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        typeof error.statusCode === 'number'
          ? error.statusCode
          : undefined;
      console.warn('[task-reminders] Transport failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
        statusCode,
      });
      const outcome = reminderFailureOutcome(statusCode);
      await record(reservation, outcome, now);
      result[outcome]++;
      continue;
    }
    await record(reservation, 'sent', now);
    result.sent++;
  }
  result.remaining += [...groups.keys()].filter((recipient) => !attempted.has(recipient)).length;
  return result;
}
