import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import type { Db } from './db';
import { getDb, inTransaction, lockResource, toDateString } from './db';
import {
  GEOCODING_STATE_KEY,
  LEGACY_GEOCODING_STATE_KEY,
  parseGeocodingCache,
} from './geocoding-cache';
import type { GeocodingCache } from './geocoding-cache';
import { dateToLocalParts } from './nikolaus-config';
import { deleteNikolausState, mutateNikolausState } from './nikolaus-state';
import { CAPACITY_LOCK, EINTEILUNG_LOCK, writeAuditLog } from './nikolaus-settings';

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

/**
 * One statement for all figures: every page of the Leitendenbereich asks for the status, and
 * separate queries would each take a connection of the pool.
 */
export async function getCleanupStatus(
  now: Date = new Date(),
  db: Db = getDb()
): Promise<CleanupStatus> {
  const figures = await db
    .selectNoFrom((eb) => {
      const count = (table: CountedTable) =>
        eb.selectFrom(table).select((sub) => sub.fn.countAll<number>().as('count'));
      return [
        count('nikolaus.booking').as('bookings'),
        count('nikolaus.dispo_visit').as('dispoVisits'),
        count('nikolaus.helper').as('helpers'),
        count('nikolaus.assignment').as('assignments'),
        eb
          .selectFrom('nikolaus.booking')
          .select((sub) => sub.fn.max('visit_date').as('last'))
          .where('status', '=', 'Bestaetigt')
          .as('booked'),
        eb
          .selectFrom('nikolaus.dispo_visit')
          .select((sub) => sub.fn.max('visited_at').as('last'))
          .as('visited'),
      ];
    })
    .executeTakeFirstOrThrow();
  const bookings = Number(figures.bookings);
  const dispoVisits = Number(figures.dispoVisits);
  const helpers = Number(figures.helpers);
  const assignments = Number(figures.assignments);
  const { booked, visited } = figures;
  const candidates = [
    booked ? toDateString(booked) : null,
    // A visit checked off after midnight still belongs to the local date it happened on
    visited ? dateToLocalParts(new Date(visited)).date : null,
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

/** Drops the cached locations of addresses, including the record of the former Nominatim search. */
async function clearGeocodingCache(trx: Transaction<Database>): Promise<number> {
  let removed = 0;
  await mutateNikolausState(
    GEOCODING_STATE_KEY,
    parseGeocodingCache,
    (current): GeocodingCache | undefined => {
      removed = current.entries.length;
      return removed ? { ...current, entries: [] } : undefined;
    },
    trx
  );
  await deleteNikolausState(LEGACY_GEOCODING_STATE_KEY, trx);
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
      await lockResource(trx, EINTEILUNG_LOCK);
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
