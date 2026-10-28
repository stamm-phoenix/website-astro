/**
 * Reminders to the current leaders of the next Leitendenrunde, sent by the timer of the Azure
 * worker (`timers/leitendenrunde-reminders.ts`, `docs/aufgaben-timer.md`). The plan is derived
 * on every run from the newest approved minutes (`leitendenrunde-termin.ts`); what has been
 * sent is stored per meeting, stage and recipient, reserved before the mail goes out, so
 * parallel runs and retries never mail twice and an unclear result is never repeated blindly.
 */
import { createHash } from 'node:crypto';
import { berlinDay } from './calendar-day';
import { campflowGetAll } from './campflow';
import type { CampflowPerson } from './campflow';
import { CONFIG } from './config';
import { reminderFailureOutcome } from './aufgaben-erinnerungen';
import {
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toVersion,
  VersionConflictError,
} from './db';
import {
  leitendenrundeMailAllowed,
  sendLeitendenrundeReminder,
} from './leitendenrunde-erinnerung-mails';
import type { Sitzung } from './leitendenrunde-termin';
import { currentSitzung, reminderStage, sitzungEnd, sitzungKey } from './leitendenrunde-termin';
import { membersWithoutAddress, protokollRecipients } from './protokolle';

export interface LeitendenrundeResult {
  day: string;
  sent: number;
  uncertain: number;
  retryable: number;
  failed: number;
  /** Recipients still waiting for their mail after this run. */
  remaining: number;
  /** Current leaders in CampFlow without a usable address; they get no mail. */
  missingAddress: number;
  reason?: 'preview' | 'no-meeting' | 'no-stage' | 'no-recipients' | 'changed';
}

interface Reservation {
  id: number;
  etag: string;
}

const RETRY_AFTER_MS = 45 * 60 * 1000;
const ABANDONED_AFTER_MS = 5 * 60 * 1000;

function hashOf(address: string): string {
  return createHash('sha256').update(address).digest('hex');
}

/**
 * The addresses of the current leaders from CampFlow, loaded afresh for every run. If CampFlow
 * fails, the error stops the run; an old list is never used instead.
 */
export async function loadLeitendenrundeRecipients(
  now: Date
): Promise<{ addresses: string[]; missing: number }> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = berlinDay(now);
  const groups = CONFIG.protokolle.campflowGroups;
  return {
    addresses: protokollRecipients(persons, today, groups).map((recipient) => recipient.email),
    missing: membersWithoutAddress(persons, today, groups),
  };
}

async function reserve(
  sitzung: Sitzung,
  stage: number,
  hash: string,
  now: Date
): Promise<Reservation | null> {
  const key = sitzungKey(sitzung);
  return inTransaction(async (trx) => {
    await lockResource(trx, `leitendenrunde-reminder:${key}:${stage}:${hash}`);
    const exists = await trx
      .selectFrom('protokoll.erinnerung')
      .select(['id', 'status', 'retry_after'])
      .where('meeting_key', '=', key)
      .where('days_before', '=', stage)
      .where('recipient_hash', '=', hash)
      .executeTakeFirst();
    if (exists) {
      if (exists.status !== 'retryable' || !exists.retry_after || exists.retry_after > now)
        return null;
      const row = await trx
        .updateTable('protokoll.erinnerung')
        .set({ status: 'attempted', attempted_at: now, retry_after: null })
        .where('id', '=', exists.id)
        .output(['inserted.id', 'inserted.version'])
        .executeTakeFirstOrThrow();
      return { id: row.id, etag: toVersion(row.version) };
    }
    const row = await trx
      .insertInto('protokoll.erinnerung')
      .values({
        meeting_key: key,
        meeting_date: sitzung.date,
        meeting_at: sitzungEnd(sitzung),
        protokoll_ref: sitzung.ref,
        days_before: stage,
        recipient_hash: hash,
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
    .deleteFrom('protokoll.erinnerung')
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
    .updateTable('protokoll.erinnerung')
    .set({
      status,
      sent_at: status === 'sent' ? now : null,
      retry_after: status === 'retryable' ? new Date(now.getTime() + RETRY_AFTER_MS) : null,
    })
    .where('id', '=', reservation.id)
    .where('version', '=', requireVersion(reservation.etag))
    .where('status', '=', 'attempted')
    .output('inserted.id')
    .executeTakeFirst();
  if (!row) throw new VersionConflictError();
}

/** Housekeeping of earlier runs; returns the counts of what turned out to be unclear or lost. */
async function settle(now: Date): Promise<{ uncertain: number; failed: number }> {
  const db = getDb();
  const cutoff = new Date(`${berlinDay(now)}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - CONFIG.leitendenrundeReminders.retentionDays);
  await db
    .deleteFrom('protokoll.erinnerung')
    .where('meeting_date', '<', cutoff.toISOString().slice(0, 10))
    .execute();
  // A run that stopped between reservation and result: the mail may or may not have gone out.
  const abandoned = await db
    .updateTable('protokoll.erinnerung')
    .set({ status: 'uncertain' })
    .where('status', '=', 'attempted')
    .where('attempted_at', '<', new Date(now.getTime() - ABANDONED_AFTER_MS))
    .output('inserted.id')
    .execute();
  // Throttled mails of a meeting that has started are not sent late.
  const expired = await db
    .updateTable('protokoll.erinnerung')
    .set({ status: 'failed', retry_after: null })
    .where('status', '=', 'retryable')
    .where('meeting_at', '<=', now)
    .output('inserted.id')
    .execute();
  return { uncertain: abandoned.length, failed: expired.length };
}

/** Whether the plan this run started with still holds: date, time and stage are unchanged. */
async function stillCurrent(sitzung: Sitzung, stage: number, clock: () => Date): Promise<boolean> {
  const again = await currentSitzung();
  // The time of this moment, not of the start of the run: the meeting may have begun meanwhile.
  return (
    again !== null &&
    sitzungKey(again) === sitzungKey(sitzung) &&
    reminderStage(again, clock()) === stage
  );
}

/**
 * Sends the reminder that is due now to every current leader who has not had it. Reserved before
 * transport: a crash or an unclear Graph error leaves the reservation, which is never resent.
 */
export async function runLeitendenrundeReminders(
  now = new Date(),
  options: {
    /** `Date.now()` value after which no further mail is started. */
    deadline?: number;
    /** The current time; by default `now` plus the time the run has taken so far. */
    clock?: () => Date;
  } = {}
): Promise<LeitendenrundeResult> {
  const { deadline = Number.POSITIVE_INFINITY } = options;
  const started = Date.now();
  const clock = options.clock ?? ((): Date => new Date(now.getTime() + Date.now() - started));
  const result: LeitendenrundeResult = {
    day: berlinDay(now),
    sent: 0,
    uncertain: 0,
    retryable: 0,
    failed: 0,
    remaining: 0,
    missingAddress: 0,
  };
  if (!leitendenrundeMailAllowed()) return { ...result, reason: 'preview' };
  const settled = await settle(now);
  result.uncertain += settled.uncertain;
  result.failed += settled.failed;

  const sitzung = await currentSitzung();
  if (!sitzung) return { ...result, reason: 'no-meeting' };
  const stage = reminderStage(sitzung, now);
  if (stage === null) return { ...result, reason: 'no-stage' };

  const recipients = await loadLeitendenrundeRecipients(now);
  result.missingAddress = recipients.missing;
  if (recipients.addresses.length === 0) return { ...result, reason: 'no-recipients' };

  const done = new Set(
    (
      await getDb()
        .selectFrom('protokoll.erinnerung')
        .select(['recipient_hash', 'status', 'retry_after'])
        .where('meeting_key', '=', sitzungKey(sitzung))
        .where('days_before', '=', stage)
        .execute()
    )
      .filter((row) => row.status !== 'retryable' || !row.retry_after || row.retry_after > now)
      .map((row) => row.recipient_hash)
  );
  const open = recipients.addresses.filter((address) => !done.has(hashOf(address)));
  let processed = 0;
  for (const [index, address] of open.entries()) {
    if (processed >= CONFIG.leitendenrundeReminders.maxMailsPerRun || Date.now() >= deadline) {
      result.remaining = open.length - index;
      break;
    }
    const reservation = await reserve(sitzung, stage, hashOf(address), now);
    if (!reservation) continue;
    processed++;
    // A new date, a cancellation or a newer approval before transport drops the old reminders.
    if (!(await stillCurrent(sitzung, stage, clock))) {
      await release(reservation);
      return { ...result, reason: 'changed' };
    }
    try {
      await sendLeitendenrundeReminder(address, sitzung);
    } catch (error) {
      const statusCode =
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        typeof error.statusCode === 'number'
          ? error.statusCode
          : undefined;
      // Only counters are logged: no addresses, no minutes.
      console.warn('[leitendenrunde-reminders] Transport failed', {
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
  return result;
}
