import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';

/**
 * Ingredients of a Planung go away with their last use: a line of a dish, stock, extra needs,
 * something bought or used when cooking. `aendere` notes the used ones before a change and
 * removes those of them that nothing uses afterwards. One added on its own (an own ingredient
 * before its first line) was not used before and stays.
 */

/** True while a row of the Planung's data points to `pz`. */
const GENUTZT = sql<boolean>`(
  exists (select 1 from essen.gericht_zutat x where x.planung_zutat_id = pz.id)
  or exists (select 1 from essen.bestand x where x.planung_zutat_id = pz.id)
  or exists (select 1 from essen.zusatzbedarf x where x.planung_zutat_id = pz.id)
  or exists (select 1 from essen.einkauf_posten x where x.planung_zutat_id = pz.id)
  or exists (select 1 from essen.einkauf_regel x where x.planung_zutat_id = pz.id)
  or exists (select 1 from essen.einplanung_verbrauch x where x.planung_zutat_id = pz.id)
)`;

/** The ingredients of the Planung something uses now. */
export async function genutzteZutaten(
  trx: Transaction<Database>,
  planungId: number
): Promise<number[]> {
  const { rows } = await sql<{ id: number }>`
    select pz.id from essen.planung_zutat pz
    where pz.planung_id = ${planungId} and ${GENUTZT}`.execute(trx);
  return rows.map((row) => row.id);
}

/** Removes those of `vorher` (used before the change) that nothing uses any more. */
export async function entferneUngenutzte(
  trx: Transaction<Database>,
  planungId: number,
  vorher: readonly number[]
): Promise<void> {
  if (!vorher.length) return;
  await sql`
    delete pz from essen.planung_zutat pz
    where pz.planung_id = ${planungId}
      and pz.id in (select cast(value as int) from openjson(${JSON.stringify(vorher)}))
      and not ${GENUTZT}`.execute(trx);
}
