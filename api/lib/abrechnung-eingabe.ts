import { sql } from 'kysely';
import { inTransaction, lockResource, toDateString, toVersion, VersionConflictError } from './db';
import { parseSession, emptySession } from './abrechnung-session';
import type { AbrechnungEingabe, AbrechnungSession } from './abrechnung-session';

export type { AbrechnungEingabe } from './abrechnung-session';

/** Same retention as existing drafts: one month after the three-month KJR deadline. */
export function abrechnungDeleteAfter(end: string): string {
  function addMonths(value: string, months: number): string {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + months, 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date.toISOString().slice(0, 10);
  }
  return addMonths(addMonths(end, 3), 1);
}

/** Refresh the trusted CampFlow deadline before expiring entries of this Aktion. */
export async function getAbrechnungEingabe(
  userId: string,
  eventId: string,
  deleteAfter: string | null
): Promise<AbrechnungEingabe> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `abrechnung-expiry:${eventId}`);
    if (deleteAfter !== null) {
      await trx
        .updateTable('organisation.abrechnung_eingabe')
        .set({ delete_after: sql<Date>`${deleteAfter}` })
        .where('event_id', '=', eventId)
        .where('delete_after', '!=', sql<Date>`${deleteAfter}`)
        .execute();
    }
    await trx
      .deleteFrom('organisation.abrechnung_eingabe')
      .where('event_id', '=', eventId)
      .where('delete_after', '<', sql<Date>`CONVERT(date, SYSUTCDATETIME())`)
      .execute();
    const row = await trx
      .selectFrom('organisation.abrechnung_eingabe')
      .selectAll()
      .where('user_id', '=', userId)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    return row
      ? {
          session: parseSession(JSON.parse(row.session)),
          etag: toVersion(row.version),
          savedAt: row.updated_at.toISOString(),
          deleteAfter: toDateString(row.delete_after),
        }
      : { session: emptySession(), etag: null, savedAt: null, deleteAfter };
  });
}

/** A row remains after resetting so a stale device cannot resurrect the old entries. */
export async function saveAbrechnungEingabe(
  userId: string,
  eventId: string,
  login: string,
  session: AbrechnungSession,
  etag: string | null,
  deleteAfter: string
): Promise<AbrechnungEingabe> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `abrechnung:${userId}:${eventId}`);
    const row = await trx
      .selectFrom('organisation.abrechnung_eingabe')
      .select('version')
      .where('user_id', '=', userId)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    if ((row ? toVersion(row.version) : null) !== etag) throw new VersionConflictError();
    const values = {
      login,
      session: JSON.stringify(session),
      delete_after: sql<Date>`${deleteAfter}`,
      updated_at: sql<Date>`SYSUTCDATETIME()`,
    };
    const saved = row
      ? await trx
          .updateTable('organisation.abrechnung_eingabe')
          .set(values)
          .where('user_id', '=', userId)
          .where('event_id', '=', eventId)
          .outputAll('inserted')
          .executeTakeFirstOrThrow()
      : await trx
          .insertInto('organisation.abrechnung_eingabe')
          .values({ user_id: userId, event_id: eventId, ...values })
          .outputAll('inserted')
          .executeTakeFirstOrThrow();
    return {
      session: parseSession(JSON.parse(saved.session)),
      etag: toVersion(saved.version),
      savedAt: saved.updated_at.toISOString(),
      deleteAfter: toDateString(saved.delete_after),
    };
  });
}
