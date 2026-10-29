import type { Db } from './db';

/**
 * Deletes a Planung of the Essensplanung with all its rows (the foreign keys cascade) and its
 * creation request. Shared by the owners' delete, the Steuerung and the retention.
 */
export async function deletePlanung(trx: Db, planungId: number): Promise<boolean> {
  await trx.deleteFrom('essen.anlage_anfrage').where('planung_id', '=', planungId).execute();
  // The dishes in the plan and the lines of the dishes point to the dishes, the members and the
  // ingredients of the Planung without a cascade, so they go first
  await trx
    .deleteFrom('essen.einplanung')
    .where('gericht_id', 'in', (eb) =>
      eb.selectFrom('essen.gericht').select('id').where('planung_id', '=', planungId)
    )
    .execute();
  await trx.deleteFrom('essen.gericht').where('planung_id', '=', planungId).execute();
  // Participants and skipped meals point to the groups without a cascade
  await trx.deleteFrom('essen.teilnehmende').where('planung_id', '=', planungId).execute();
  await trx
    .deleteFrom('essen.mahlzeit_ohne_gruppe')
    .where('gruppe_id', 'in', (eb) =>
      eb.selectFrom('essen.planung_gruppe').select('id').where('planung_id', '=', planungId)
    )
    .execute();
  // Stock and extra needs point to the ingredients, the ingredients to the shops, both without
  // a cascade
  await trx.deleteFrom('essen.bestand').where('planung_id', '=', planungId).execute();
  await trx.deleteFrom('essen.zusatzbedarf').where('planung_id', '=', planungId).execute();
  await trx.deleteFrom('essen.planung_zutat').where('planung_id', '=', planungId).execute();
  const result = await trx
    .deleteFrom('essen.planung')
    .where('id', '=', planungId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
