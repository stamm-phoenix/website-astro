import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Db } from './db';
import type { Database } from './db-schema';
import { inTransaction } from './db';
import { darfBearbeiten, darfMitgliederVerwalten } from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import type { Zugang } from './essen-zugang';
import { LINK_UNGUELTIG, NICHT_ERLAUBT, NUR_LESEN, WARTUNG } from './essen-zugang';

/**
 * The change protocol of a Planung: every change bumps `essen.planung.aenderung_seq` in its
 * transaction, which also serializes the changes of one Planung, and is logged in
 * `essen.aenderung`; the pages poll the counter.
 */

export async function istWartung(db: Db): Promise<boolean> {
  return (await loadEssenEinstellungen(db)).einstellungen.wartung;
}

/**
 * Starts a change: bumps the counter (which locks the Planung until the end of the transaction)
 * unless the Steuerung switched the Essensplanung to maintenance, in one statement. Returns the
 * new counter and the setting of the Planung for the checks of the caller.
 */
export async function beginneAenderung(
  trx: Transaction<Database>,
  planungId: number
): Promise<{ seq: string; mitgliederVerwalten: boolean; beitrittToken: string | null }> {
  const bumped = await trx
    .updateTable('essen.planung')
    .set({
      aenderung_seq: sql<string>`aenderung_seq + 1`,
      geaendert_am: sql<Date>`SYSUTCDATETIME()`,
    })
    .output(['inserted.aenderung_seq', 'inserted.mitglieder_verwalten', 'inserted.beitritt_token'])
    .where('id', '=', planungId)
    .where(({ not, exists, selectFrom }) =>
      not(exists(selectFrom('essen.einstellungen').select('id').where('wartung', '=', true)))
    )
    .executeTakeFirst();
  if (!bumped) {
    // Nothing was bumped: either maintenance mode or no such Planung
    if (await istWartung(trx)) throw WARTUNG();
    throw LINK_UNGUELTIG();
  }
  return {
    seq: bumped.aenderung_seq,
    mitgliederVerwalten: bumped.mitglieder_verwalten,
    beitrittToken: bumped.beitritt_token,
  };
}

/** Logs a change under the counter `beginneAenderung` returned. */
export async function protokolliereAenderung(
  trx: Transaction<Database>,
  planungId: number,
  seq: string,
  mitgliedId: number | null,
  aktion: string,
  details: Record<string, unknown>
): Promise<void> {
  await trx
    .insertInto('essen.aenderung')
    .values({
      planung_id: planungId,
      seq,
      mitglied_id: mitgliedId,
      aktion,
      details: JSON.stringify(details),
    })
    .execute();
}

interface AendernOptionen {
  /** Who may do it: edit (default), manage members, or only owners. */
  recht?: 'bearbeiten' | 'verwalten' | 'besitzer';
}

/**
 * Runs a change of a Planung in one transaction: checks the access and the maintenance mode,
 * bumps the change counter and logs the change.
 */
export async function aendere<T>(
  zugang: Zugang,
  aktion: string,
  /** Gets the access as checked in the transaction, with the member's current role. */
  work: (
    trx: Transaction<Database>,
    aktuell: Zugang
  ) => Promise<{ result: T; details: Record<string, unknown> }>,
  { recht = 'bearbeiten' }: AendernOptionen = {}
): Promise<T> {
  if (!darfBearbeiten(zugang.zugang)) throw NUR_LESEN();
  return inTransaction(async (trx) => {
    const bumped = await beginneAenderung(trx, zugang.planungId);
    // The member may have lost access or the role since the link was read
    if (zugang.mitgliedId !== null) {
      const mitglied = await trx
        .selectFrom('essen.mitglied')
        .select(['rolle', 'entzogen_am'])
        .where('id', '=', zugang.mitgliedId)
        .executeTakeFirst();
      if (!mitglied || mitglied.entzogen_am) throw LINK_UNGUELTIG();
      zugang = { ...zugang, zugang: mitglied.rolle };
    }
    if (recht === 'besitzer' && zugang.zugang !== 'besitzer') throw NICHT_ERLAUBT();
    if (
      recht === 'verwalten' &&
      !darfMitgliederVerwalten(zugang.zugang, bumped.mitgliederVerwalten)
    ) {
      throw NICHT_ERLAUBT();
    }
    const { result, details } = await work(trx, zugang);
    await protokolliereAenderung(
      trx,
      zugang.planungId,
      bumped.seq,
      zugang.mitgliedId,
      aktion,
      details
    );
    return result;
  });
}
