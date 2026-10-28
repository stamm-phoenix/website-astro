import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { CONFIG } from './config';
import { getDb, inTransaction, lockResource, parseId, requireVersion, toVersion } from './db';
import type { Db } from './db';
import type { ProblemMeldungTable } from './db-schema';
import { PREVIEW_DATABASE } from './deployment';
import type {
  ProblemLabel,
  ProblemReport,
  ProblemVerdict,
  StaffProblemMeldung,
} from './problemmeldung-model';

/**
 * Problemmeldungen in Azure SQL (`problem.meldung`, migration `0051_problemmeldung.sql`): the
 * reports of „Problem melden“, the assessment of the language model, the issue draft and the
 * result of the hand-over to GitHub. `docs/problemmeldungen.md` describes the flow.
 */

/** The state of a report does not allow the action (already sent, discarded or being sent). */
export class ProblemStateError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ProblemStateError';
  }
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toStaffItem(row: Selectable<ProblemMeldungTable>): StaffProblemMeldung {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    createdAt: row.created_at.toISOString(),
    entry: row.entry,
    environment: row.environment,
    description: row.description,
    steps: row.steps,
    expected: row.expected,
    contact: row.contact,
    context: {
      page: row.page,
      module: row.module,
      errorCode: row.error_code,
      httpStatus: row.http_status,
      action: row.action,
      correlationId: row.correlation_id,
      appVersion: row.app_version,
      browser: row.browser,
      viewport: row.viewport,
    },
    status: row.status,
    ai: {
      status: row.ai_status,
      verdict: row.ai_verdict,
      reason: row.ai_reason,
      error: row.ai_error,
      at: iso(row.ai_at),
    },
    draft: { title: row.draft_title, body: row.draft_body, label: row.github_label },
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    discardReason: row.discard_reason,
    github: {
      number: row.github_number,
      url: row.github_url,
      at: iso(row.github_at),
      pending: row.github_number === null && row.github_started_at !== null,
    },
  };
}

/** Stores a new report and returns its ID. */
export async function createProblemMeldung(
  report: ProblemReport,
  db: Db = getDb()
): Promise<number> {
  const { context } = report;
  const { id } = await db
    .insertInto('problem.meldung')
    .values({
      entry: report.entry,
      description: report.description,
      steps: report.steps,
      expected: report.expected,
      contact: report.contact,
      page: context.page,
      module: context.module,
      error_code: context.errorCode,
      http_status: context.httpStatus,
      action: context.action,
      correlation_id: context.correlationId,
      app_version: context.appVersion,
      environment: PREVIEW_DATABASE ? 'vorschau' : 'produktion',
      browser: context.browser,
      viewport: context.viewport,
      ai_verdict: null,
      ai_started_at: null,
      ai_at: null,
      reviewed_at: null,
      github_started_at: null,
      github_first_at: null,
      github_number: null,
      github_at: null,
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return id;
}

/**
 * Whether the reports of the last hour or day reached the limit. Counted in the database, so
 * all Function instances share it; the proof of work of the form makes each report expensive,
 * this caps the assessments if someone pays that price anyway.
 */
async function isProblemQuotaReached(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom('problem.meldung')
    .select([
      sql<number>`COUNT(CASE WHEN created_at >= DATEADD(hour, -1, SYSUTCDATETIME()) THEN 1 END)`.as(
        'hour'
      ),
      sql<number>`COUNT(*)`.as('day'),
    ])
    .where('created_at', '>=', sql<Date>`DATEADD(day, -1, SYSUTCDATETIME())`)
    .executeTakeFirstOrThrow();
  return (
    row.hour >= CONFIG.problemmeldung.hourlyLimit || row.day >= CONFIG.problemmeldung.dailyLimit
  );
}

/**
 * Stores a new report unless the limit of the last hour or day is reached (`null`). Counting
 * and storing run under one lock, so reports that arrive at once cannot all pass the same count.
 */
export async function storeProblemMeldung(report: ProblemReport): Promise<number | null> {
  return inTransaction(async (trx) => {
    await lockResource(trx, 'problemmeldung-quota');
    return (await isProblemQuotaReached(trx)) ? null : createProblemMeldung(report, trx);
  });
}

/** All reports, the newest first. */
export async function getProblemMeldungen(): Promise<StaffProblemMeldung[]> {
  const rows = await getDb()
    .selectFrom('problem.meldung')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map(toStaffItem);
}

/** One report, or `undefined` for an unknown ID. */
export async function getProblemMeldung(id: string): Promise<StaffProblemMeldung | undefined> {
  const numericId = parseId(id);
  if (numericId === undefined) return undefined;
  const row = await getDb()
    .selectFrom('problem.meldung')
    .selectAll()
    .where('id', '=', numericId)
    .executeTakeFirst();
  return row ? toStaffItem(row) : undefined;
}

/**
 * Why a conditional write did nothing: the report is gone (`undefined`), was changed by
 * someone else, or is not open any more.
 */
export async function explainProblemConflict(id: string, etag: string): Promise<ProblemStateError> {
  const current = await getProblemMeldung(id);
  if (!current) return new ProblemStateError('Die Meldung wurde inzwischen gelöscht.');
  if (current.status === 'verworfen')
    return new ProblemStateError('Die Meldung wurde inzwischen verworfen.');
  if (current.status === 'uebermittelt')
    return new ProblemStateError('Die Meldung wurde inzwischen an GitHub gesendet.');
  if (current.github.pending)
    return new ProblemStateError(
      'Die Meldung wird gerade an GitHub gesendet. Lade die Seite neu und warte einen Moment.'
    );
  return new ProblemStateError(
    current.etag === etag
      ? 'Die Meldung konnte nicht geändert werden.'
      : 'Die Meldung wurde inzwischen von jemand anderem geändert. Bitte lade sie neu.'
  );
}

export interface ProblemDraft {
  title: string;
  body: string;
  label: ProblemLabel;
}

/** Saves the issue draft of an open report that still has the version `etag`. */
export async function saveProblemDraft(
  id: string,
  draft: ProblemDraft,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw await explainProblemConflict(id, etag);
  const result = await getDb()
    .updateTable('problem.meldung')
    .set({
      draft_title: draft.title,
      draft_body: draft.body,
      github_label: draft.label,
      status: 'in_pruefung',
      reviewed_by: actor,
    })
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .where('status', 'in', ['neu', 'in_pruefung'])
    .where('github_started_at', 'is', null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw await explainProblemConflict(id, etag);
}

/**
 * Discards an open report that still has the version `etag`. The contact address is deleted
 * with it: nobody needs it any more.
 */
export async function discardProblemMeldung(
  id: string,
  reason: string,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw await explainProblemConflict(id, etag);
  const result = await getDb()
    .updateTable('problem.meldung')
    .set({
      status: 'verworfen',
      discard_reason: reason,
      reviewed_by: actor,
      reviewed_at: sql<string>`SYSUTCDATETIME()`,
      contact: '',
    })
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .where('status', 'in', ['neu', 'in_pruefung'])
    .where('github_started_at', 'is', null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw await explainProblemConflict(id, etag);
}

// --- Assessment -----------------------------------------------------------------------------

/**
 * Marks the report as being assessed, so two requests do not ask the model twice. Works for a
 * report that has no assessment yet or whose last attempt failed; an attempt that has run for
 * more than five minutes counts as dead. Returns false if the report is not open or already
 * has an assessment.
 */
export async function claimProblemAssessment(id: number): Promise<boolean> {
  const result = await getDb()
    .updateTable('problem.meldung')
    .set({ ai_status: 'laeuft', ai_started_at: sql<string>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('status', 'in', ['neu', 'in_pruefung'])
    .where((eb) =>
      eb.or([
        eb('ai_status', 'in', ['offen', 'fehler', 'nicht_eingerichtet']),
        eb.and([
          eb('ai_status', '=', 'laeuft'),
          eb('ai_started_at', '<', sql<Date>`DATEADD(minute, -5, SYSUTCDATETIME())`),
        ]),
      ])
    )
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export interface ProblemAssessment {
  verdict: ProblemVerdict;
  reason: string;
  title: string;
  body: string;
  label: ProblemLabel;
}

/**
 * Stores the assessment. The draft is only filled if nobody has started one, so a leader's text
 * is never overwritten.
 */
export async function saveProblemAssessment(
  id: number,
  assessment: ProblemAssessment
): Promise<void> {
  await getDb()
    .updateTable('problem.meldung')
    .set({
      ai_status: 'fertig',
      ai_verdict: assessment.verdict,
      ai_reason: assessment.reason,
      ai_error: '',
      ai_at: sql<string>`SYSUTCDATETIME()`,
      draft_title: sql<string>`CASE WHEN draft_title = N'' THEN ${assessment.title} ELSE draft_title END`,
      draft_body: sql<string>`CASE WHEN draft_title = N'' THEN ${assessment.body} ELSE draft_body END`,
      github_label: sql<ProblemLabel>`CASE WHEN draft_title = N'' THEN ${assessment.label} ELSE github_label END`,
    })
    .where('id', '=', id)
    .where('ai_status', '=', 'laeuft')
    .execute();
}

/** Stores that the assessment failed or is not set up; the report stays and can be retried. */
export async function saveProblemAssessmentFailure(
  id: number,
  status: 'fehler' | 'nicht_eingerichtet',
  error: string
): Promise<void> {
  await getDb()
    .updateTable('problem.meldung')
    .set({ ai_status: status, ai_error: error.slice(0, 200) })
    .where('id', '=', id)
    .where('ai_status', '=', 'laeuft')
    .execute();
}

// --- GitHub ---------------------------------------------------------------------------------

/** After this many minutes an unfinished hand-over may be retried (it is checked first). */
export const GITHUB_ATTEMPT_MINUTES = 2;

/**
 * Reserves the hand-over of an open report that still has the version `etag`, so repeated
 * clicks and two people at once send only once. Returns `null` if the reservation was not
 * possible, otherwise when the first earlier attempt that ended unclear started (`null`
 * inside: there was none).
 */
export async function claimProblemGithub(
  id: string,
  etag: string,
  actor: string
): Promise<{ previousAttempt: Date | null } | null> {
  const numericId = parseId(id);
  if (numericId === undefined) return null;
  const row = await getDb()
    .updateTable('problem.meldung')
    .set({
      github_started_at: sql<string>`SYSUTCDATETIME()`,
      // The first unclear attempt stays the start of every later search
      github_first_at: sql<string>`COALESCE(github_first_at, SYSUTCDATETIME())`,
      status: 'in_pruefung',
      reviewed_by: actor,
    })
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .where('status', 'in', ['neu', 'in_pruefung'])
    .where('github_number', 'is', null)
    .where((eb) =>
      eb.or([
        eb('github_started_at', 'is', null),
        eb(
          'github_started_at',
          '<',
          sql<Date>`DATEADD(minute, -${sql.lit(GITHUB_ATTEMPT_MINUTES)}, SYSUTCDATETIME())`
        ),
      ])
    )
    .output('deleted.github_first_at as previous')
    .executeTakeFirst();
  return row ? { previousAttempt: row.previous } : null;
}

/** Stores the issue of a report; the report is sent and its contact address deleted. */
export async function saveProblemGithub(id: string, number: number, url: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) return;
  await getDb()
    .updateTable('problem.meldung')
    .set({
      status: 'uebermittelt',
      github_number: number,
      github_url: url,
      github_at: sql<string>`SYSUTCDATETIME()`,
      reviewed_at: sql<string>`SYSUTCDATETIME()`,
      contact: '',
    })
    .where('id', '=', numericId)
    .where('github_number', 'is', null)
    .execute();
}

/** Gives the reservation back after a hand-over that certainly created no issue. */
export async function releaseProblemGithub(id: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) return;
  await getDb()
    .updateTable('problem.meldung')
    .set({ github_started_at: null, github_first_at: null })
    .where('id', '=', numericId)
    .where('github_number', 'is', null)
    .execute();
}

// --- Retention ------------------------------------------------------------------------------

let lastPurge = 0;

/**
 * Deletes the reports that are past their retention: discarded ones after 30 days, those sent
 * to GitHub after 90 (the issue stays), open ones after 180. Runs at most once an hour per
 * Function instance, whenever a report comes in or a leader opens the module.
 * @returns the number of deleted reports, or `null` if it ran recently.
 */
export async function purgeExpiredProblemMeldungen(now = Date.now()): Promise<number | null> {
  if (now - lastPurge < 3_600_000) return null;
  lastPurge = now;
  const { discardedDays, sentDays, openDays } = CONFIG.problemmeldung.retention;
  const ago = (days: number) => sql<Date>`DATEADD(day, -${sql.lit(days)}, SYSUTCDATETIME())`;
  const result = await getDb()
    .deleteFrom('problem.meldung')
    .where((eb) =>
      eb.or([
        eb.and([eb('status', '=', 'verworfen'), eb('reviewed_at', '<', ago(discardedDays))]),
        eb.and([eb('status', '=', 'uebermittelt'), eb('github_at', '<', ago(sentDays))]),
        eb.and([eb('status', 'in', ['neu', 'in_pruefung']), eb('created_at', '<', ago(openDays))]),
      ])
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Resets the hourly guard of the retention, for tests. */
export function resetProblemPurge(): void {
  lastPurge = 0;
}
