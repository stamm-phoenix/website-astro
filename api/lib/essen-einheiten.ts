import { VersionConflictError, requireVersion } from './db';
import type { EinheitenZeileInput } from './essen-einheiten-model';
import type { Zugang } from './essen-planung';
import { aendere } from './essen-planung';
import { zutatDerPlanung } from './essen-planung-zutat';
import { ValidationError } from './validation/errors';

/**
 * Saves the amounts of one ingredient converted into one unit (`docs/essensplanung.md`,
 * „Einheiten“): lines of dishes, extra needs and stock, each with the version the page showed,
 * all or none in one change. A line changed meanwhile is a conflict, and nothing is saved.
 */

const TABELLE = {
  gericht: 'essen.gericht_zutat',
  zusatzbedarf: 'essen.zusatzbedarf',
  bestand: 'essen.bestand',
} as const;

export async function einheitenUebernehmen(
  zugang: Zugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): Promise<void> {
  if (!zeilen.length)
    throw new ValidationError({ zeilen: 'Bitte mindestens eine Menge umrechnen.' });
  await aendere(zugang, 'einheiten-vereinheitlicht', async (trx) => {
    const zutat = await zutatDerPlanung(trx, zugang, planungZutatId);
    for (const zeile of zeilen) {
      // Only amounts of this ingredient in this Planung; a line of a dish reaches it by its dish
      const version = requireVersion(zeile.etag);
      const result =
        zeile.stelle === 'gericht'
          ? await trx
              .updateTable('essen.gericht_zutat')
              .set({ menge: zeile.menge, einheit: zeile.einheit })
              .where('id', '=', zeile.id)
              .where('planung_zutat_id', '=', planungZutatId)
              .where('menge', 'is not', null)
              .where('gericht_id', 'in', (eb) =>
                eb
                  .selectFrom('essen.gericht')
                  .select('id')
                  .where('planung_id', '=', zugang.planungId)
              )
              .where('version', '=', version)
              .executeTakeFirst()
          : // Stock and extra needs have the same columns
            await trx
              .updateTable(TABELLE[zeile.stelle] as 'essen.bestand')
              .set({ menge: zeile.menge, einheit: zeile.einheit })
              .where('id', '=', zeile.id)
              .where('planung_zutat_id', '=', planungZutatId)
              .where('planung_id', '=', zugang.planungId)
              .where('menge', 'is not', null)
              .where('version', '=', version)
              .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new VersionConflictError();
    }
    return {
      result: undefined,
      details: { name: zutat.name ?? zutat.z_name, anzahl: zeilen.length },
    };
  });
}
