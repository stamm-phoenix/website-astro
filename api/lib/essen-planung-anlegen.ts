import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { MAX_TAGE, addDays, daysBetween } from './essen-planung-model';
import type { EssenEinstellungen } from './essen-validation';

/**
 * Creates a Planung with its owner, the template groups and the days with their template meals
 * (`docs/essensplanung.md`, Anlegen). Shared by the confirmation link of the public page and by
 * creating from the Leitendenbereich; the caller checks who may create and the maintenance mode.
 */

export interface NeuePlanung {
  planungName: string;
  /** The owner's name and address. */
  name: string;
  email: string;
  /** `YYYY-MM-DD`. */
  ersterTag: string;
  letzterTag: string;
  /** SHA-256 of the owner's token for the link from the mail. */
  tokenHash: string;
}

export async function legePlanungAn(
  trx: Transaction<Database>,
  neu: NeuePlanung,
  einstellungen: EssenEinstellungen
): Promise<{ planungId: number; besitzerId: number }> {
  const planung = await trx
    .insertInto('essen.planung')
    .values({ name: neu.planungName })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const besitzer = await trx
    .insertInto('essen.mitglied')
    .values({
      planung_id: planung.id,
      name: neu.name,
      email: neu.email,
      rolle: 'besitzer',
      token_hash: neu.tokenHash,
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  // The owner created it; it is no invitation
  await trx.insertInto('essen.mitglied_geoeffnet').values({ mitglied_id: besitzer.id }).execute();
  if (einstellungen.vorlageGruppen.length) {
    await trx
      .insertInto('essen.planung_gruppe')
      .values(
        einstellungen.vorlageGruppen.map((gruppe, index) => ({
          planung_id: planung.id,
          position: index + 1,
          name: gruppe.name,
          faktor: gruppe.faktor,
        }))
      )
      .execute();
  }
  const anzahl = Math.min(daysBetween(neu.ersterTag, neu.letzterTag) + 1, MAX_TAGE);
  for (let index = 0; index < anzahl; index++) {
    const tag = await trx
      .insertInto('essen.tag')
      .values({ planung_id: planung.id, datum: addDays(neu.ersterTag, index) })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    if (einstellungen.vorlageMahlzeiten.length) {
      await trx
        .insertInto('essen.mahlzeit')
        .values(
          einstellungen.vorlageMahlzeiten.map((name, position) => ({
            tag_id: tag.id,
            position: position + 1,
            name,
          }))
        )
        .execute();
    }
  }
  await trx
    .updateTable('essen.planung')
    .set({ aenderung_seq: '1' })
    .where('id', '=', planung.id)
    .execute();
  await trx
    .insertInto('essen.aenderung')
    .values({
      planung_id: planung.id,
      seq: 1,
      mitglied_id: besitzer.id,
      aktion: 'planung-angelegt',
      details: JSON.stringify({ name: neu.planungName }),
    })
    .execute();
  return { planungId: planung.id, besitzerId: besitzer.id };
}
