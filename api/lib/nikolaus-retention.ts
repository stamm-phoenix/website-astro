import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import { CONFIG } from './config';
import type { Database } from './db-schema';
import { getDb, inTransaction, toDateString } from './db';
import type { Db } from './db';
import { parseGeocodingState } from './geocoding-coordination';
import { listNikolausStates, mutateNikolausState, readNikolausState } from './nikolaus-state';
import { getAllDispoRows } from './nikolaus-dispo-list';
import type { RetentionSeasonPolicy } from './nikolaus-retention-schedule';

/** Personal data a run could not delete safely; it needs a person to look at it. */
export interface RetainedRecord {
  kind: 'booking' | 'helper';
  id: string;
  reason:
    | 'dependent_dispo_outside_cutoff'
    | 'availability_outside_cutoff'
    | 'dependent_einteilung_outside_cutoff'
    | 'unclassified_availability';
}

/** The dated facts of all Nikolaus data, without contact details. */
export interface RetentionSources {
  bookings: { id: string; slotKey: string }[];
  dispo: {
    bookingId: string;
    date: string;
    slotKey: string;
    plannedArrival: string;
    visitedAt: string;
  }[];
  helpers: { id: string; dates: string[] }[];
  einteilung: { personId: string; date: string }[];
  policies: RetentionSeasonPolicy[];
  geocoding: { cachedLookups: number };
}

export interface RetentionOptions {
  season: number;
  /** Deletes visit/availability dates strictly before this date in the selected season. */
  before: string;
  /** Who is responsible for the run, recorded in the report. */
  responsibleRole: string;
}

/** What a run deletes; only IDs and counts, never family or helper details. */
export interface RetentionPlan {
  options: RetentionOptions;
  bookingIds: string[];
  helperIds: string[];
  /** Days whose Dispo and Einteilung rows are deleted. */
  dates: string[];
  dispoRows: number;
  einteilungRows: number;
  geocodingCacheEntries: number;
  retained: RetainedRecord[];
}

export interface RetentionReport {
  options: RetentionOptions;
  startedAt: string;
  finishedAt: string;
  /** Everything of the season before the cutoff is gone and nothing was retained. */
  complete: boolean;
  deleted: {
    bookings: number;
    helpers: number;
    dispoRows: number;
    einteilungRows: number;
    geocodingCacheEntries: number;
  };
  retained: RetainedRecord[];
}

const GEOCODING_STATE_KEY = 'geocoding:nominatim';

export function retentionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Binds automatic runs to the configured database, without storing credentials. */
export function getRetentionTargetDigest(): string {
  return retentionDigest({ server: CONFIG.database.server, database: CONFIG.database.name });
}

function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Loads the dated facts of all Nikolaus data. */
export async function loadRetentionSources(db: Db = getDb()): Promise<RetentionSources> {
  const [bookings, dispo, helpers, availability, einteilung, policies, geocoding] =
    await Promise.all([
      db.selectFrom('nikolaus.booking').select(['id', 'slot_key']).execute(),
      getAllDispoRows(db),
      db.selectFrom('nikolaus.helper').select('id').execute(),
      db.selectFrom('nikolaus.helper_availability').select(['helper_id', 'date']).execute(),
      db.selectFrom('nikolaus.assignment').select(['helper_id', 'date']).execute(),
      listNikolausStates('retention:schedule:', db),
      readNikolausState(GEOCODING_STATE_KEY, db),
    ]);
  const dates = new Map<number, Set<string>>();
  for (const row of availability) {
    const set = dates.get(row.helper_id) ?? new Set<string>();
    set.add(toDateString(row.date));
    dates.set(row.helper_id, set);
  }
  const geocodingState = geocoding ? parseGeocodingState(geocoding.data) : undefined;
  return {
    bookings: bookings.map((row) => ({ id: String(row.id), slotKey: row.slot_key })),
    dispo: dispo.map((row) => ({
      bookingId: row.bookingId,
      date: row.date,
      slotKey: row.slotKey,
      plannedArrival: row.plannedArrival,
      visitedAt: row.visitedAt,
    })),
    helpers: helpers.map((row) => ({
      id: String(row.id),
      dates: [...(dates.get(row.id) ?? [])].sort(),
    })),
    einteilung: einteilung.map((row) => ({
      personId: String(row.helper_id),
      date: toDateString(row.date),
    })),
    policies: policies.map((state) => state.data as RetentionSeasonPolicy),
    geocoding: { cachedLookups: geocodingState?.cache.length ?? 0 },
  };
}

/** Selects what a run with these options deletes and what it has to keep. */
export function planNikolausRetention(
  sources: RetentionSources,
  options: RetentionOptions
): RetentionPlan {
  if (
    !Number.isInteger(options.season) ||
    options.season < 2000 ||
    options.season > 2200 ||
    !validDate(options.before) ||
    !options.responsibleRole.trim()
  ) {
    throw new Error('Retention requires a season, a real cutoff date and a responsible role');
  }
  const selected = (date: string): boolean =>
    date.startsWith(`${options.season}-`) && date < options.before;
  const retained: RetainedRecord[] = [];

  const dispoRows = sources.dispo.filter((row) => selected(row.date));
  const einteilungRows = sources.einteilung.filter((row) => selected(row.date));
  const dates = new Set([...dispoRows, ...einteilungRows].map((row) => row.date));

  const bookingIds: string[] = [];
  for (const booking of sources.bookings) {
    if (!selected(booking.slotKey.slice(0, 10))) continue;
    if (sources.dispo.some((row) => row.bookingId === booking.id && !selected(row.date))) {
      retained.push({ kind: 'booking', id: booking.id, reason: 'dependent_dispo_outside_cutoff' });
    } else {
      bookingIds.push(booking.id);
    }
  }

  const helperIds: string[] = [];
  for (const helper of sources.helpers) {
    if (helper.dates.length === 0) {
      retained.push({ kind: 'helper', id: helper.id, reason: 'unclassified_availability' });
      continue;
    }
    if (!helper.dates.some(selected)) continue;
    if (!helper.dates.every(selected)) {
      retained.push({ kind: 'helper', id: helper.id, reason: 'availability_outside_cutoff' });
    } else if (
      sources.einteilung.some((row) => row.personId === helper.id && !selected(row.date))
    ) {
      retained.push({
        kind: 'helper',
        id: helper.id,
        reason: 'dependent_einteilung_outside_cutoff',
      });
    } else {
      helperIds.push(helper.id);
    }
  }

  return {
    options,
    // Stable order, so two previews of the same data are identical
    bookingIds: bookingIds.sort((a, b) => Number(a) - Number(b)),
    helperIds: helperIds.sort((a, b) => Number(a) - Number(b)),
    dates: [...dates].sort(),
    dispoRows: dispoRows.length,
    einteilungRows: einteilungRows.length,
    geocodingCacheEntries: sources.geocoding.cachedLookups,
    retained: retained.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}

function chunks<T>(items: T[], size = 1000): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Blocks every other writer of the Nikolaus tables until the transaction ends. */
async function lockNikolausTables(trx: Transaction<Database>): Promise<void> {
  for (const table of ['booking', 'dispo_visit', 'helper', 'helper_availability', 'assignment']) {
    await sql`SELECT TOP 0 1 FROM ${sql.table(`nikolaus.${table}`)} WITH (TABLOCKX, HOLDLOCK)`.execute(
      trx
    );
  }
}

/**
 * Deletes the selected data of a season in one transaction. The plan is calculated inside the
 * transaction with all Nikolaus tables locked, so nothing can change between selecting and
 * deleting; a failure deletes nothing.
 */
export async function applyNikolausRetention(
  options: RetentionOptions,
  now: Date = new Date()
): Promise<RetentionReport> {
  if (options.before > now.toISOString().slice(0, 10)) {
    throw new Error('Retention cutoff is in the future');
  }
  const startedAt = new Date().toISOString();
  return inTransaction(async (trx) => {
    await lockNikolausTables(trx);
    const plan = planNikolausRetention(await loadRetentionSources(trx), options);

    for (const dates of chunks(plan.dates)) {
      await trx.deleteFrom('nikolaus.dispo_visit').where('date', 'in', dates).execute();
      await trx.deleteFrom('nikolaus.assignment').where('date', 'in', dates).execute();
    }
    for (const ids of chunks(plan.bookingIds.map(Number))) {
      await trx.deleteFrom('nikolaus.booking').where('id', 'in', ids).execute();
    }
    for (const ids of chunks(plan.helperIds.map(Number))) {
      await trx.deleteFrom('nikolaus.helper').where('id', 'in', ids).execute();
    }
    if (plan.geocodingCacheEntries > 0) {
      // Keep the rate limiter, its cooldown and a running lookup. Only cached locations go; a
      // lookup finishing afterwards stores a fresh one, not data of the deleted season.
      await mutateNikolausState(
        GEOCODING_STATE_KEY,
        parseGeocodingState,
        (state) => ({ ...state, cache: [] }),
        trx
      );
    }

    const remaining = planNikolausRetention(await loadRetentionSources(trx), options);
    return {
      options,
      startedAt,
      finishedAt: new Date().toISOString(),
      complete:
        remaining.bookingIds.length === 0 &&
        remaining.helperIds.length === 0 &&
        remaining.dates.length === 0 &&
        remaining.retained.length === 0,
      deleted: {
        bookings: plan.bookingIds.length,
        helpers: plan.helperIds.length,
        dispoRows: plan.dispoRows,
        einteilungRows: plan.einteilungRows,
        geocodingCacheEntries: plan.geocodingCacheEntries,
      },
      retained: remaining.retained,
    };
  });
}
