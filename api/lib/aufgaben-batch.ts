import type { Insertable, Transaction } from 'kysely';
import type { Database, TaskTable } from './db-schema';

/** A task row has about 25 columns; this keeps a statement below the 2100 parameters of SQL Server. */
const TASKS_PER_STATEMENT = 50;

/** Inserts task rows in a few statements instead of one per row, in the given transaction. */
export async function insertTasks(
  trx: Transaction<Database>,
  rows: Insertable<TaskTable>[]
): Promise<void> {
  for (let from = 0; from < rows.length; from += TASKS_PER_STATEMENT)
    await trx
      .insertInto('organisation.task')
      .values(rows.slice(from, from + TASKS_PER_STATEMENT))
      .execute();
}
