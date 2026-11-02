import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { CONFIG } from './config';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Db } from './db';
import type { SchnupperAnfrageTable } from './db-schema-schnupper';
import type {
  SchnupperAbsage,
  SchnupperAnfrageInput,
  SchnupperBestaetigung,
  StaffSchnupperAnfrage,
} from './schnupper-model';

/**
 * Schnupperstunden-Anfragen in Azure SQL (`organisation.schnupper_anfrage`, migration 0070,
 * #139): families ask for a Schnupperstunde, Leitende confirm a date or cancel.
 */

const TABLE = 'organisation.schnupper_anfrage';

function toStaffItem(row: Selectable<SchnupperAnfrageTable>): StaffSchnupperAnfrage {
  return {
    id: row.id,
    etag: toVersion(row.version),
    createdAt: row.created_at.toISOString(),
    alter: row.alter_jahre,
    stufe: row.stufe,
    kindVorname: row.kind_vorname,
    name: row.kontakt_name,
    email: row.email,
    telefon: row.telefon,
    wunschzeit: row.wunschzeit,
    nachricht: row.nachricht,
    status: row.status,
    termin:
      row.status === 'bestaetigt' && row.termin_datum && row.termin_zeit
        ? { datum: toDateString(row.termin_datum), zeit: row.termin_zeit, ort: row.termin_ort }
        : null,
    antwort: row.antwort,
    antwortMail: row.antwort_mail,
    bearbeitetVon: row.bearbeitet_von,
    bearbeitetAm: row.bearbeitet_am ? row.bearbeitet_am.toISOString() : null,
  };
}

/** Whether the requests of the last hour or day reached the limit of all instances. */
async function isQuotaReached(db: Db): Promise<boolean> {
  const row = await db
    .selectFrom(TABLE)
    .select([
      sql<number>`COUNT(CASE WHEN created_at >= DATEADD(hour, -1, SYSUTCDATETIME()) THEN 1 END)`.as(
        'hour'
      ),
      sql<number>`COUNT(*)`.as('day'),
    ])
    .where('created_at', '>=', sql<Date>`DATEADD(day, -1, SYSUTCDATETIME())`)
    .executeTakeFirstOrThrow();
  return row.hour >= CONFIG.schnupper.hourlyLimit || row.day >= CONFIG.schnupper.dailyLimit;
}

/**
 * Stores a new request unless the limit of the last hour or day is reached (`null`). Counting
 * and storing run under one lock, so requests that arrive at once cannot pass the same count.
 */
export async function storeSchnupperAnfrage(
  anfrage: SchnupperAnfrageInput
): Promise<StaffSchnupperAnfrage | null> {
  return inTransaction(async (trx) => {
    await lockResource(trx, 'schnupper-quota');
    if (await isQuotaReached(trx)) return null;
    const row = await trx
      .insertInto(TABLE)
      .values({
        alter_jahre: anfrage.alter,
        stufe: anfrage.stufe,
        kind_vorname: anfrage.kindVorname,
        kontakt_name: anfrage.name,
        email: anfrage.email,
        telefon: anfrage.telefon,
        wunschzeit: anfrage.wunschzeit,
        nachricht: anfrage.nachricht,
        termin_datum: null,
        termin_zeit: null,
      })
      .outputAll('inserted')
      .executeTakeFirstOrThrow();
    return toStaffItem(row);
  });
}

/** All requests: open ones first, each group the newest first. */
export async function getSchnupperAnfragen(): Promise<StaffSchnupperAnfrage[]> {
  const rows = await getDb()
    .selectFrom(TABLE)
    .selectAll()
    .orderBy(sql`CASE WHEN status = 'offen' THEN 0 ELSE 1 END`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map(toStaffItem);
}

/** One request, or `undefined` for an unknown ID. */
export async function getSchnupperAnfrage(
  id: number,
  db: Db = getDb()
): Promise<StaffSchnupperAnfrage | undefined> {
  const row = await db.selectFrom(TABLE).selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toStaffItem(row) : undefined;
}

/** Throws why a conditional write changed nothing: the request is gone or was changed. */
async function notChanged(db: Db, id: number): Promise<never> {
  const exists = await db.selectFrom(TABLE).select('id').where('id', '=', id).executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Writes an answer to a request that still has the version `etag` and returns it. */
async function answer(
  id: number,
  etag: string,
  values: {
    status: 'bestaetigt' | 'abgesagt';
    termin_datum: string | null;
    termin_zeit: string | null;
    termin_ort: string;
    antwort: string;
  },
  actor: string
): Promise<StaffSchnupperAnfrage> {
  return inTransaction(async (trx) => {
    const result = await trx
      .updateTable(TABLE)
      .set({
        ...values,
        antwort_mail: null,
        bearbeitet_von: actor,
        bearbeitet_am: sql<Date>`SYSUTCDATETIME()`,
      })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) await notChanged(trx, id);
    const updated = await getSchnupperAnfrage(id, trx);
    if (!updated) throw new RecordNotFoundError();
    return updated;
  });
}

/** Confirms a date (also a new one for a request confirmed before). */
export function confirmSchnupperAnfrage(
  id: number,
  input: SchnupperBestaetigung,
  etag: string,
  actor: string
): Promise<StaffSchnupperAnfrage> {
  return answer(
    id,
    etag,
    {
      status: 'bestaetigt',
      termin_datum: input.datum,
      termin_zeit: input.zeit,
      termin_ort: input.ort,
      antwort: input.antwort,
    },
    actor
  );
}

/** Cancels a request, open or confirmed. */
export function cancelSchnupperAnfrage(
  id: number,
  input: SchnupperAbsage,
  etag: string,
  actor: string
): Promise<StaffSchnupperAnfrage> {
  return answer(
    id,
    etag,
    {
      status: 'abgesagt',
      termin_datum: null,
      termin_zeit: null,
      termin_ort: '',
      antwort: input.antwort,
    },
    actor
  );
}

/**
 * Notes whether the answer mail reached the family. Not conditional: it runs right after the
 * answer and only records what happened to it. Returns the request in its new version, or
 * `undefined` if it was deleted meanwhile.
 */
export async function markSchnupperMail(
  id: number,
  sent: boolean
): Promise<StaffSchnupperAnfrage | undefined> {
  await getDb().updateTable(TABLE).set({ antwort_mail: sent }).where('id', '=', id).execute();
  return getSchnupperAnfrage(id);
}

/** Deletes a request that still has the version `etag`. */
export async function deleteSchnupperAnfrage(id: number, etag: string): Promise<void> {
  const db = getDb();
  const result = await db
    .deleteFrom(TABLE)
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(db, id);
}

/**
 * Deletes requests past their retention: open ones some time after they arrived, confirmed
 * ones after the date and cancelled ones after the answer (`CONFIG.schnupper.retention`).
 */
export async function purgeExpiredSchnupperAnfragen(): Promise<void> {
  const { openDays, confirmedDays, cancelledDays } = CONFIG.schnupper.retention;
  await getDb()
    .deleteFrom(TABLE)
    .where((eb) =>
      eb.or([
        eb.and([
          eb('status', '=', 'offen'),
          eb('created_at', '<', sql<Date>`DATEADD(day, ${-openDays}, SYSUTCDATETIME())`),
        ]),
        eb.and([
          eb('status', '=', 'bestaetigt'),
          eb(
            'termin_datum',
            '<',
            sql<string>`CAST(DATEADD(day, ${-confirmedDays}, SYSUTCDATETIME()) AS date)`
          ),
        ]),
        eb.and([
          eb('status', '=', 'abgesagt'),
          eb('bearbeitet_am', '<', sql<Date>`DATEADD(day, ${-cancelledDays}, SYSUTCDATETIME())`),
        ]),
      ])
    )
    .execute();
}
