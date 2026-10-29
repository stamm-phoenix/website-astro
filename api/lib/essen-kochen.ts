import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { VersionConflictError, requireVersion, toDateString } from './db';
import { einplanungDerPlanung, mahlzeitDerPlanung } from './essen-einplanung';
import { einheitPasst, einheitText } from './essen-gerichte-model';
import type { AbhakenInput, Verbrauch } from './essen-kochen-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { zutatDerPlanungFuer } from './essen-planung-zutat';
import { ValidationError } from './validation/errors';

/**
 * Ticking off planned dishes after their meal (`docs/essensplanung.md`, Kochen abhaken): cooked
 * with what was really used, or left out. The stock of the Planung follows from it.
 */

/** Every ingredient used must be one of this Planung, measured in its kind of unit. */
async function pruefeZutaten(
  trx: Transaction<Database>,
  zugang: Zugang,
  verbrauch: Verbrauch[]
): Promise<void> {
  const ids = [...new Set(verbrauch.map((eintrag) => eintrag.planungZutatId))].sort(
    (a, b) => a - b
  );
  for (const id of ids) {
    // Takes the lock of an inherited kind of unit, like the other amounts of the Planung
    const zutat = await zutatDerPlanungFuer(
      trx,
      zugang,
      { planungZutatId: id },
      { lebensmittel: false }
    ).catch(() => null);
    if (!zutat) {
      throw new ValidationError({
        verbrauch: 'Eine der Zutaten gibt es nicht mehr. Bitte lade die Seite neu.',
      });
    }
    const falsch = verbrauch.find(
      (eintrag) =>
        eintrag.planungZutatId === id && !einheitPasst(zutat.einheitenart, eintrag.einheit)
    );
    if (falsch) {
      throw new ValidationError({
        verbrauch: `${zutat.name} wird nicht in ${einheitText(falsch.einheit)} gemessen. Bitte lade die Seite neu.`,
      });
    }
  }
}

/**
 * Sets a planned dish to cooked (with what it used), left out, or open again, on the version it
 * was seen in. What it used before is replaced.
 */
export async function einplanungAbhaken(
  zugang: Zugang,
  id: number,
  input: AbhakenInput,
  etag: string
): Promise<void> {
  await aendere(zugang, 'einplanung-abgehakt', async (trx) => {
    const einplanung = await einplanungDerPlanung(trx, zugang, id);
    const mahlzeit = await mahlzeitDerPlanung(trx, zugang, einplanung.mahlzeit_id);
    await pruefeZutaten(trx, zugang, input.verbrauch);
    const result = await trx
      .updateTable('essen.einplanung')
      .set({ status: input.status })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    await trx.deleteFrom('essen.einplanung_verbrauch').where('einplanung_id', '=', id).execute();
    if (input.verbrauch.length) {
      await trx
        .insertInto('essen.einplanung_verbrauch')
        .values(
          input.verbrauch.map((eintrag) => ({
            einplanung_id: id,
            planung_zutat_id: eintrag.planungZutatId,
            menge: eintrag.menge,
            einheit: eintrag.einheit,
          }))
        )
        .execute();
    }
    return {
      result: undefined,
      details: {
        name: einplanung.name,
        mahlzeit: mahlzeit.name,
        datum: toDateString(mahlzeit.datum),
        status: input.status,
      },
    };
  });
}
