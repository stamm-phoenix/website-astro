import { sql } from 'kysely';
import type { Db } from './db';
import { getDb, toDateString } from './db';
import { essenMail, loeschwarnungMail } from './essen-mails';
import { addDays, LOESCHWARNUNG_TAGE, loeschDatum } from './essen-planung-model';
import { deletePlanung } from './essen-planung-loeschen';
import { belegOrdnerAufraeumen } from './essen-belege';
import { loadEssenEinstellungen } from './essen-steuerung';

/**
 * Retention of the Essensplanung, run once a day by the timer `essensplanungAufbewahrung`: a
 * Planung is deleted when its last day is longer ago than the retention of the Steuerung; its
 * owners get a mail 14 days before. Unconfirmed requests to create one go after a week.
 */

export interface AufbewahrungErgebnis {
  geloescht: number;
  gewarnt: number;
  anfragenGeloescht: number;
  mailFehler: number;
  /** Photo folders of deleted Planungen removed from Blob Storage. */
  fotoOrdnerGeloescht: number;
}

/** The day a Planung is deleted, from its last day (or the day it was created without days). */
async function loeschtAmVon(db: Db, planungId: number, monate: number): Promise<string | null> {
  const row = await db
    .selectFrom('essen.planung as p')
    .leftJoin('essen.tag as t', 't.planung_id', 'p.id')
    .select(['p.erstellt_am', (eb) => eb.fn.max('t.datum').as('letzter')])
    .where('p.id', '=', planungId)
    .groupBy('p.erstellt_am')
    .executeTakeFirst();
  if (!row) return null;
  const letzterTag = row.letzter
    ? toDateString(row.letzter as Date | string)
    : row.erstellt_am.toISOString().slice(0, 10);
  return loeschDatum(letzterTag, monate);
}

export async function raeumeAuf(
  now: Date = new Date(),
  db: Db = getDb()
): Promise<AufbewahrungErgebnis> {
  const heute = now.toISOString().slice(0, 10);
  const ergebnis: AufbewahrungErgebnis = {
    geloescht: 0,
    gewarnt: 0,
    anfragenGeloescht: 0,
    mailFehler: 0,
    fotoOrdnerGeloescht: 0,
  };

  const anfragen = await db
    .deleteFrom('essen.anlage_anfrage')
    .where('erstellt_am', '<', new Date(now.getTime() - 7 * 24 * 60 * 60_000))
    .executeTakeFirst();
  ergebnis.anfragenGeloescht = Number(anfragen.numDeletedRows);

  const { einstellungen } = await loadEssenEinstellungen(db);
  const planungen = await db.selectFrom('essen.planung').select(['id', 'name']).execute();

  for (const planung of planungen) {
    const loeschtAm = await loeschtAmVon(db, planung.id, einstellungen.aufbewahrungMonate);
    if (!loeschtAm) continue;
    if (heute >= loeschtAm) {
      const geloescht = await db.transaction().execute(async (trx) => {
        // Holds back changes of the Planung (they bump its row first), then decides again on
        // the current days and retention: a Planung extended meanwhile stays
        await sql`SELECT id FROM essen.planung WITH (UPDLOCK, HOLDLOCK) WHERE id = ${planung.id}`.execute(
          trx
        );
        const aktuell = await loeschtAmVon(
          trx,
          planung.id,
          (await loadEssenEinstellungen(trx)).einstellungen.aufbewahrungMonate
        );
        if (!aktuell || heute < aktuell || !(await deletePlanung(trx, planung.id))) return false;
        await trx
          .insertInto('essen.audit_log')
          .values({
            actor: 'Aufbewahrung',
            action: 'planung-geloescht',
            details: JSON.stringify({ id: planung.id, name: planung.name, loeschtAm: aktuell }),
          })
          .execute();
        return true;
      });
      if (geloescht) ergebnis.geloescht++;
      continue;
    }
    if (heute < addDays(loeschtAm, -LOESCHWARNUNG_TAGE)) continue;
    // Each owner once per deletion date; a failed mail is tried again the next day
    const besitzer = await db
      .selectFrom('essen.mitglied')
      .select(['id', 'name', 'email'])
      .where('planung_id', '=', planung.id)
      .where('rolle', '=', 'besitzer')
      .where('entzogen_am', 'is', null)
      .where('email', 'is not', null)
      .where((eb) =>
        eb.or([eb('loeschwarnung_fuer', 'is', null), eb('loeschwarnung_fuer', '<>', loeschtAm)])
      )
      .execute();
    let gewarnt = false;
    for (const person of besitzer) {
      const mail = loeschwarnungMail(person.name, planung.name, loeschtAm);
      try {
        await essenMail.send(person.email!, mail.subject, mail.html);
      } catch {
        ergebnis.mailFehler++;
        continue;
      }
      await db
        .updateTable('essen.mitglied')
        .set({ loeschwarnung_fuer: loeschtAm })
        .where('id', '=', person.id)
        .execute();
      gewarnt = true;
    }
    if (gewarnt) ergebnis.gewarnt++;
  }
  // The photos of deleted Planungen, also those a deletion before could not remove
  ergebnis.fotoOrdnerGeloescht = await belegOrdnerAufraeumen(db);
  return ergebnis;
}
