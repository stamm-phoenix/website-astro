import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import type { Db } from './db';
import { getDb, inTransaction, lockResource, toDateString } from './db';
import { parseGeocodingState } from './geocoding-coordination';
import type { GeocodingState } from './geocoding-coordination';
import { dateToLocalParts } from './nikolaus-config';
import { mutateNikolausState } from './nikolaus-state';
import { CAPACITY_LOCK, writeAuditLog } from './nikolaus-settings';

/**
 * Deleting the personal data after the Nikolausdienst, by hand from the Steuerung. The data
 * must be gone one calendar month after the last visit (privacy policy, `/datenschutz`); the
 * Steuerung shows that date and the Leitendenbereich reminds when it has passed.
 */

export type CleanupScope = 'bookings' | 'helpers';

/** What has to be typed to confirm a deletion. */
export const CLEANUP_CONFIRMATIONS: Record<CleanupScope, string> = {
  bookings: 'ANMELDUNGEN LÖSCHEN',
  helpers: 'HELFENDE LÖSCHEN',
};

export interface CleanupStatus {
  bookings: number;
  dispoVisits: number;
  helpers: number;
  assignments: number;
  /** Latest visit day (checked off or booked and confirmed), local date. */
  lastVisit: string | null;
  /** One calendar month after `lastVisit`: the data must be deleted by then. */
  deleteBy: string | null;
  /** `deleteBy` has been reached and there is still data. */
  due: boolean;
}

/** Adds one calendar month; month ends are clamped (31 January → 28/29 February). */
export function addCalendarMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

type CountedTable =
  'nikolaus.booking' | 'nikolaus.helper' | 'nikolaus.dispo_visit' | 'nikolaus.assignment';

async function count(db: Db, table: CountedTable): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function getCleanupStatus(
  now: Date = new Date(),
  db: Db = getDb()
): Promise<CleanupStatus> {
  const [bookings, dispoVisits, helpers, assignments, booked, visited] = await Promise.all([
    count(db, 'nikolaus.booking'),
    count(db, 'nikolaus.dispo_visit'),
    count(db, 'nikolaus.helper'),
    count(db, 'nikolaus.assignment'),
    db
      .selectFrom('nikolaus.booking')
      .select((eb) => eb.fn.max('visit_date').as('last'))
      .where('status', '=', 'Bestaetigt')
      .executeTakeFirst(),
    db
      .selectFrom('nikolaus.dispo_visit')
      .select((eb) => eb.fn.max('visited_at').as('last'))
      .executeTakeFirst(),
  ]);
  const candidates = [
    booked?.last ? toDateString(booked.last) : null,
    // A visit checked off after midnight still belongs to the local date it happened on
    visited?.last ? dateToLocalParts(new Date(visited.last)).date : null,
  ].filter((date): date is string => date !== null);
  const lastVisit = candidates.length ? candidates.sort().at(-1)! : null;
  const deleteBy = lastVisit ? addCalendarMonth(lastVisit) : null;
  const today = dateToLocalParts(now).date;
  return {
    bookings,
    dispoVisits,
    helpers,
    assignments,
    lastVisit,
    deleteBy,
    due: deleteBy !== null && deleteBy <= today && bookings + helpers > 0,
  };
}

export interface CleanupResult {
  scope: CleanupScope;
  deleted: Record<string, number>;
}

/** Drops the cached locations of addresses; lease and pace of the geocoding stay. */
async function clearGeocodingCache(trx: Transaction<Database>): Promise<number> {
  let removed = 0;
  await mutateNikolausState(
    'geocoding:nominatim',
    parseGeocodingState,
    (current): GeocodingState | undefined => {
      removed = current.cache.length;
      return removed ? { ...current, cache: [] } : undefined;
    },
    trx
  );
  return removed;
}

/**
 * Deletes all bookings with their Dispo, or all helpers with their availability and
 * Einteilung, in one transaction, and records it in the log. IDs are not reset: an old
 * offline queue of the Fahrt view must never hit a booking of the next season.
 */
export async function deleteNikolausData(
  scope: CleanupScope,
  actor: string
): Promise<CleanupResult> {
  return inTransaction(async (trx) => {
    const deleted: Record<string, number> = {};
    if (scope === 'bookings') {
      // No booking can be added while this runs
      await lockResource(trx, CAPACITY_LOCK);
      deleted.dispoVisits = Number(
        (await trx.deleteFrom('nikolaus.dispo_visit').executeTakeFirst()).numDeletedRows
      );
      deleted.bookings = Number(
        (await trx.deleteFrom('nikolaus.booking').executeTakeFirst()).numDeletedRows
      );
      deleted.geocodingCache = await clearGeocodingCache(trx);
    } else {
      await lockResource(trx, 'nikolaus:einteilung');
      deleted.assignments = Number(
        (await trx.deleteFrom('nikolaus.assignment').executeTakeFirst()).numDeletedRows
      );
      deleted.availabilities = Number(
        (await trx.deleteFrom('nikolaus.helper_availability').executeTakeFirst()).numDeletedRows
      );
      deleted.helpers = Number(
        (await trx.deleteFrom('nikolaus.helper').executeTakeFirst()).numDeletedRows
      );
    }
    await writeAuditLog(trx, actor, `delete-${scope}`, { deleted });
    return { scope, deleted };
  });
}
