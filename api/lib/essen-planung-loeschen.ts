import type { Db } from './db';

/**
 * Deletes a Planung of the Essensplanung with all its rows (the foreign keys cascade) and its
 * creation request. Shared by the owners' delete, the Steuerung and the retention.
 */
export async function deletePlanung(trx: Db, planungId: number): Promise<boolean> {
  await trx.deleteFrom('essen.anlage_anfrage').where('planung_id', '=', planungId).execute();
  const result = await trx
    .deleteFrom('essen.planung')
    .where('id', '=', planungId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
