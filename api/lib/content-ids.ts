import type { Transaction } from 'kysely';
import { lockResource } from './db';
import type { Database } from './db-schema';

/**
 * IDs of the Gruppenstunden, Leitende, Aktionen and Belege. They are no IDENTITY columns,
 * because the rows taken over from SharePoint kept the IDs of the list items and the website may
 * not run `SET IDENTITY_INSERT` (migration `0024_gruppenstunden_leitende.sql`). A counter per table
 * (`content.id_counter`, migration `0025_content_id_counter.sql`) only grows, so the ID of a
 * deleted person, and with it the folder of their photos, never goes to someone else.
 */
export type ContentIdTable =
  'content.gruppenstunde' | 'content.leitende' | 'content.aktion' | 'organisation.beleg';

async function highestId(trx: Transaction<Database>, table: ContentIdTable): Promise<number> {
  const [counter, rows] = await Promise.all([
    trx
      .selectFrom('content.id_counter')
      .select('last_id')
      .where('table_name', '=', table)
      .executeTakeFirstOrThrow(),
    trx
      .selectFrom(table)
      .select((eb) => eb.fn.max<number | null>('id').as('max'))
      .executeTakeFirst(),
  ]);
  return Math.max(counter.last_id, Number(rows?.max ?? 0));
}

async function setCounter(
  trx: Transaction<Database>,
  table: ContentIdTable,
  lastId: number
): Promise<void> {
  await trx
    .updateTable('content.id_counter')
    .set({ last_id: lastId })
    .where('table_name', '=', table)
    .execute();
}

/**
 * Locks the IDs of `table` and returns the next one, which is used up from then on. Callers
 * insert the row in the same transaction.
 */
export async function nextContentId(
  trx: Transaction<Database>,
  table: ContentIdTable
): Promise<number> {
  await lockResource(trx, `${table}:id`);
  const id = (await highestId(trx, table)) + 1;
  await setCounter(trx, table, id);
  return id;
}
