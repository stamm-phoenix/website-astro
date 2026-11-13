import { sql } from 'kysely';
import type { Db } from './db';

/**
 * Counts every change of the central lists of the Essensplanung (ingredients, categories,
 * allergens; `essen.katalog_stand`, `0088`), so the polling pages read one row instead of
 * scanning three tables. Every write to those tables calls it after the write, in the same
 * transaction; `essensplanung-katalog-stand.test.ts` finds a write that does not.
 */
export async function katalogGeaendert(trx: Db): Promise<void> {
  await trx
    .updateTable('essen.katalog_stand')
    .set({ seq: sql<string>`seq + 1` })
    .where('id', '=', 1)
    .execute();
}
