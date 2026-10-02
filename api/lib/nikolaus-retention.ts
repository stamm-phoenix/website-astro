import { createHash } from 'node:crypto';
import { getGraphStatus } from './sharepoint-data-access';
import { parseGeocodingState } from './geocoding-coordination';
import type { NikolausStateRecord } from './nikolaus-state';

export type RetentionList = 'booking' | 'dispo' | 'helper' | 'einteilung';

export interface RetentionSources {
  booking: unknown[];
  dispo: unknown[];
  helper: unknown[];
  einteilung: unknown[];
  states: NikolausStateRecord[];
}

export interface RetentionOptions {
  season: number;
  /** Deletes visit/availability dates strictly before this date in the selected season. */
  before: string;
  /** A role assigned by the operator, not a claim about an existing responsible person. */
  responsibleRole: string;
}

export interface RetentionOperation {
  kind: RetentionList | 'state-delete' | 'state-update';
  id: string;
  etag: string;
  key?: string;
  /** Allows a repeated apply to recognize an already completed state update. */
  remainingDigest?: string;
  removedRows?: number;
}

export interface RetentionPlan {
  schema: 1;
  createdAt: string;
  options: RetentionOptions;
  /** Binds a saved plan to the exact site and list IDs, without storing credentials. */
  targetDigest: string;
  operations: RetentionOperation[];
  retained: { kind: RetentionList; id: string; reason: string }[];
  digest: string;
}

export interface RetentionReport {
  planDigest: string;
  startedAt: string;
  finishedAt: string;
  complete: boolean;
  verificationErrorCode?: number | 'UNKNOWN';
  results: {
    kind: RetentionOperation['kind'];
    id: string;
    status: 'deleted' | 'updated' | 'already_absent' | 'already_updated' | 'failed' | 'skipped';
    attempts: number;
    errorCode?: number | 'UNKNOWN' | 'DEPENDENCY';
  }[];
}

export interface RetentionBackend {
  load: () => Promise<RetentionSources>;
  delete: (operation: RetentionOperation) => Promise<void>;
  updateState: (operation: RetentionOperation, data: unknown) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Called after each operation so a crash still leaves a checkable partial report. */
  report?: (report: RetentionReport) => void;
  /** Durable automatic reports must finish before the next deletion is attempted. */
  persistReport?: (report: RetentionReport) => Promise<void>;
}

interface ListRow {
  id: string;
  etag: string;
  fields: Record<string, unknown>;
}

interface Snapshot {
  schema: 1;
  rows: Record<string, unknown>[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listRow(value: unknown): ListRow {
  if (
    !object(value) ||
    !text(value.id) ||
    !text(value.eTag) ||
    value.eTag === '*' ||
    !object(value.fields)
  )
    throw new Error('Retention requires complete list rows with ETags');
  return { id: text(value.id), etag: text(value.eTag), fields: value.fields };
}

function dateOf(value: unknown): string {
  const date = text(value).slice(0, 10);
  if (!validDate(date)) throw new Error('Retention encountered an invalid date');
  return date;
}

function snapshot(value: unknown): Snapshot {
  if (
    !object(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.rows) ||
    !value.rows.every(object)
  )
    throw new Error('Retention encountered an invalid planning snapshot');
  for (const row of value.rows as Record<string, unknown>[]) dateOf(row.date);
  return { schema: 1, rows: value.rows as Record<string, unknown>[] };
}

export function retentionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function selected(date: string, options: RetentionOptions): boolean {
  return date.startsWith(`${options.season}-`) && date < options.before;
}

function helperDates(row: ListRow): string[] {
  const raw: unknown = JSON.parse(text(row.fields.Verfuegbarkeit) || '{}');
  if (!object(raw)) throw new Error('Retention encountered invalid helper availability');
  return Object.keys(raw).map(dateOf);
}

function remainingState(
  state: NikolausStateRecord,
  options: RetentionOptions,
  at: number
): unknown {
  if (state.key === 'planning:einteilung') {
    const loaded = snapshot(state.data);
    return { schema: 1, rows: loaded.rows.filter((row) => !selected(dateOf(row.date), options)) };
  }
  if (state.key === 'geocoding:nominatim') {
    const loaded = parseGeocodingState(state.data);
    if (loaded.lease && loaded.lease.expires + 6_100 > at) {
      throw new Error('An active geocoding lookup prevents retention');
    }
    // Keep the rate limiter and its cooldown. Only cached location data is removed.
    return { version: 1, nextRequestAt: loaded.nextRequestAt, cache: [] };
  }
  throw new Error('Unknown retention state update');
}

function planContent(plan: RetentionPlan): unknown {
  return {
    schema: plan.schema,
    options: plan.options,
    targetDigest: plan.targetDigest,
    operations: plan.operations,
    retained: plan.retained,
  };
}

/** Builds a PII-free preview from legacy rows and the authoritative planning snapshots. */
export function planNikolausRetention(
  sources: RetentionSources,
  options: RetentionOptions,
  targetDigest: string,
  now: Date = new Date()
): RetentionPlan {
  if (
    !Number.isInteger(options.season) ||
    options.season < 2000 ||
    options.season > 2200 ||
    !validDate(options.before) ||
    !options.responsibleRole.trim() ||
    !/^[a-f0-9]{64}$/.test(targetDigest)
  ) {
    throw new Error(
      'Retention requires a season, a real cutoff date, a responsible role and target'
    );
  }
  const parsed = {
    booking: sources.booking.map(listRow),
    dispo: sources.dispo.map(listRow),
    helper: sources.helper.map(listRow),
    einteilung: sources.einteilung.map(listRow),
  };
  const operations: RetentionOperation[] = [];
  const retained: RetentionPlan['retained'] = [];
  const add = (kind: RetentionOperation['kind'], row: { id: string; etag: string }): void => {
    operations.push({ kind, id: row.id, etag: row.etag });
  };
  for (const row of parsed.dispo)
    if (selected(dateOf(row.fields.Datum), options)) add('dispo', row);
  for (const row of parsed.einteilung)
    if (selected(dateOf(row.fields.Datum), options)) add('einteilung', row);

  const snapshotDispo: Record<string, unknown>[] = [];
  const snapshotEinteilung: Record<string, unknown>[] = [];
  for (const state of sources.states) {
    if (!state.id || !state.etag || state.etag === '*')
      throw new Error('Retention requires state ETags');
    if (state.key.startsWith('planning:dispo:')) {
      const date = dateOf(state.key.slice('planning:dispo:'.length));
      const loaded = snapshot(state.data);
      if (loaded.rows.some((row) => dateOf(row.date) !== date || !text(row.bookingId))) {
        throw new Error('Dispo snapshot dates or booking references do not match its key');
      }
      snapshotDispo.push(...loaded.rows);
      if (selected(date, options))
        operations.push({ kind: 'state-delete', id: state.id, etag: state.etag, key: state.key });
    } else if (state.key === 'planning:einteilung' || state.key === 'geocoding:nominatim') {
      const remaining = remainingState(state, options, now.getTime());
      if (state.key === 'planning:einteilung') {
        const rows = snapshot(state.data).rows;
        if (rows.some((row) => !text(row.personId))) {
          throw new Error('Einteilung snapshot contains invalid helper references');
        }
        snapshotEinteilung.push(...rows);
      }
      if (retentionDigest(state.data) !== retentionDigest(remaining)) {
        const removedRows =
          state.key === 'planning:einteilung'
            ? snapshot(state.data).rows.length - snapshot(remaining).rows.length
            : parseGeocodingState(state.data).cache.length;
        operations.push({
          kind: 'state-update',
          id: state.id,
          etag: state.etag,
          key: state.key,
          remainingDigest: retentionDigest(remaining),
          removedRows,
        });
      }
    }
  }

  for (const row of parsed.booking) {
    const date = dateOf(row.fields.SlotKey);
    if (!selected(date, options)) continue;
    const outsideLegacy = parsed.dispo.some(
      (dependent) =>
        text(dependent.fields.Title) === row.id &&
        !selected(dateOf(dependent.fields.Datum), options)
    );
    const outsideSnapshot = snapshotDispo.some(
      (dependent) =>
        text(dependent.bookingId) === row.id && !selected(dateOf(dependent.date), options)
    );
    if (outsideLegacy || outsideSnapshot)
      retained.push({ kind: 'booking', id: row.id, reason: 'dependent_dispo_outside_cutoff' });
    else add('booking', row);
  }
  for (const row of parsed.helper) {
    const dates = helperDates(row);
    if (!dates.some((date) => selected(date, options))) continue;
    if (!dates.every((date) => selected(date, options))) {
      retained.push({ kind: 'helper', id: row.id, reason: 'availability_outside_cutoff' });
      continue;
    }
    const outsideLegacy = parsed.einteilung.some(
      (dependent) =>
        String(dependent.fields.HelferId ?? '') === row.id &&
        !selected(dateOf(dependent.fields.Datum), options)
    );
    const outsideSnapshot = snapshotEinteilung.some(
      (dependent) =>
        text(dependent.personId) === row.id && !selected(dateOf(dependent.date), options)
    );
    if (outsideLegacy || outsideSnapshot)
      retained.push({ kind: 'helper', id: row.id, reason: 'dependent_einteilung_outside_cutoff' });
    else add('helper', row);
  }
  const priority: Record<RetentionOperation['kind'], number> = {
    dispo: 0,
    einteilung: 1,
    'state-delete': 2,
    'state-update': 3,
    booking: 4,
    helper: 5,
  };
  operations.sort((a, b) => priority[a.kind] - priority[b.kind] || a.id.localeCompare(b.id));
  retained.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const plan: RetentionPlan = {
    schema: 1,
    createdAt: now.toISOString(),
    options,
    targetDigest,
    operations,
    retained,
    digest: '',
  };
  plan.digest = retentionDigest(planContent(plan));
  return plan;
}

/** Checks saved JSON before it can authorize writes. The hash detects accidental edits. */
export function parseRetentionPlan(value: unknown): RetentionPlan {
  if (
    !object(value) ||
    value.schema !== 1 ||
    !object(value.options) ||
    typeof value.createdAt !== 'string' ||
    typeof value.targetDigest !== 'string' ||
    typeof value.digest !== 'string' ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.retained)
  ) {
    throw new Error('Invalid retention plan');
  }
  const plan = value as unknown as RetentionPlan;
  for (const operation of plan.operations) {
    if (
      !object(operation) ||
      !['booking', 'dispo', 'helper', 'einteilung', 'state-delete', 'state-update'].includes(
        operation.kind
      ) ||
      !text(operation.id) ||
      !text(operation.etag) ||
      operation.etag === '*'
    )
      throw new Error('Invalid retention operation');
    if (operation.kind.startsWith('state-') && !text(operation.key))
      throw new Error('Missing state key');
  }
  if (retentionDigest(planContent(plan)) !== plan.digest)
    throw new Error('Retention plan digest mismatch');
  return plan;
}

function operationKey(operation: RetentionOperation): string {
  return `${operation.kind}:${operation.id}`;
}

/** Applies only the reviewed rows. Conflicts stop the run and preserve affected parent rows. */
export async function applyNikolausRetention(
  plan: RetentionPlan,
  targetDigest: string,
  backend: RetentionBackend,
  now: Date = new Date()
): Promise<RetentionReport> {
  parseRetentionPlan(plan);
  if (plan.targetDigest !== targetDigest)
    throw new Error('Retention plan targets another site or lists');
  if (plan.options.before > now.toISOString().slice(0, 10))
    throw new Error('Retention cutoff is in the future');
  const report: RetentionReport = {
    planDigest: plan.digest,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    complete: false,
    results: [],
  };
  let sources = await backend.load();
  const current = planNikolausRetention(sources, plan.options, targetDigest, now);
  const reviewed = new Map(
    plan.operations.map((operation) => [operationKey(operation), operation])
  );
  for (const operation of current.operations) {
    const previous = reviewed.get(operationKey(operation));
    if (
      !previous ||
      previous.etag !== operation.etag ||
      previous.remainingDigest !== operation.remainingDigest
    ) {
      throw new Error('Retention data changed since preview; create a new preview');
    }
  }
  if (retentionDigest(current.retained) !== retentionDigest(plan.retained)) {
    throw new Error('Retention dependencies changed since preview');
  }
  const sleep = backend.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let failed = false;
  for (const operation of plan.operations) {
    const result: RetentionReport['results'][number] = {
      kind: operation.kind,
      id: operation.id,
      status: 'skipped',
      attempts: 0,
    };
    report.results.push(result);
    if (!failed) {
      try {
        // Refresh before every parent deletion to catch rows recreated during the run.
        if (operation.kind === 'booking' || operation.kind === 'helper') {
          sources = await backend.load();
          const dependencies =
            operation.kind === 'booking'
              ? sources.dispo.map(listRow).some((row) => text(row.fields.Title) === operation.id) ||
                sources.states
                  .filter((state) => state.key.startsWith('planning:dispo:'))
                  .some((state) =>
                    snapshot(state.data).rows.some((row) => text(row.bookingId) === operation.id)
                  )
              : sources.einteilung
                  .map(listRow)
                  .some((row) => String(row.fields.HelferId ?? '') === operation.id) ||
                sources.states
                  .filter((state) => state.key === 'planning:einteilung')
                  .some((state) =>
                    snapshot(state.data).rows.some((row) => text(row.personId) === operation.id)
                  );
          if (dependencies) {
            result.errorCode = 'DEPENDENCY';
            throw new Error('Dependent rows still exist');
          }
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
          result.attempts = attempt;
          try {
            if (operation.kind === 'state-update') {
              const state = sources.states.find(
                (row) => row.id === operation.id && row.key === operation.key
              );
              if (!state) {
                result.status = 'already_absent';
                break;
              }
              if (retentionDigest(state.data) === operation.remainingDigest) {
                result.status = 'already_updated';
                break;
              }
              const remaining = remainingState(state, plan.options, now.getTime());
              if (
                state.etag !== operation.etag ||
                retentionDigest(remaining) !== operation.remainingDigest
              ) {
                result.errorCode = 412;
                throw new Error('State changed since preview');
              }
              await backend.updateState(operation, remaining);
              result.status = 'updated';
            } else {
              await backend.delete(operation);
              result.status = 'deleted';
            }
            break;
          } catch (error: unknown) {
            const status = getGraphStatus(error);
            if (status === 404) {
              result.status = 'already_absent';
              break;
            }
            if ((status === 429 || status === 503 || status === 504) && attempt < 3) {
              await sleep(1_000 * attempt);
              continue;
            }
            result.errorCode ??= status ?? 'UNKNOWN';
            throw error;
          }
        }
      } catch {
        failed = true;
        result.status = 'failed';
        result.errorCode ??= 'UNKNOWN';
      }
    }
    report.finishedAt = new Date().toISOString();
    backend.report?.(report);
    await backend.persistReport?.(report);
  }
  try {
    const verified = planNikolausRetention(
      await backend.load(),
      plan.options,
      targetDigest,
      new Date()
    );
    report.complete = !failed && verified.operations.length === 0 && verified.retained.length === 0;
  } catch (error: unknown) {
    report.verificationErrorCode = getGraphStatus(error) ?? 'UNKNOWN';
  }
  report.finishedAt = new Date().toISOString();
  backend.report?.(report);
  await backend.persistReport?.(report);
  return report;
}
