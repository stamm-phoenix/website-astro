import type { Insertable, Transaction } from 'kysely';
import type { Database, TaskTable } from './db-schema';

/** Rows per statement: a task has at most 15 columns, SQL Server takes 2100 parameters. */
const TASK_ROWS_PER_STATEMENT = 100;

/**
 * Inserts tasks with multi-row statements instead of one statement per task, in the given
 * order. All rows of a call need the same columns. Meant for checklists and suggestions, which
 * insert dozens of tasks while holding locks.
 */
export async function insertTaskRows(
  trx: Transaction<Database>,
  rows: Insertable<TaskTable>[]
): Promise<void> {
  for (let start = 0; start < rows.length; start += TASK_ROWS_PER_STATEMENT) {
    await trx
      .insertInto('organisation.task')
      .values(rows.slice(start, start + TASK_ROWS_PER_STATEMENT))
      .execute();
  }
}
