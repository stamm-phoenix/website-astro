import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';
import { usageMonth } from './staff-usage-model';

export async function recordStaffUsage(module: string, now = new Date()): Promise<void> {
  await pruneStaffUsage(now);
  const month = usageMonth(now);
  await inTransaction(async (trx) => {
    await lockResource(trx, 'staff-usage:' + month + ':' + module);
    const row = await trx
      .selectFrom('organisation.staff_usage')
      .select('visits')
      .where('month', '=', month)
      .where('module', '=', module)
      .executeTakeFirst();
    if (row) {
      await trx
        .updateTable('organisation.staff_usage')
        .set({ visits: sql<number>`visits + 1` })
        .where('month', '=', month)
        .where('module', '=', module)
        .execute();
    } else {
      await trx
        .insertInto('organisation.staff_usage')
        .values({ month, module, visits: 1 })
        .execute();
    }
  });
}

/** Current UTC calendar month and the preceding two months. Only aggregated totals leave the API. */
export async function getStaffUsage(now = new Date()): Promise<Record<string, number>> {
  await pruneStaffUsage(now);
  const rows = await getDb()
    .selectFrom('organisation.staff_usage')
    .select(['module', (eb) => eb.fn.sum<number>('visits').as('visits')])
    .where('month', '>=', usageMonth(now, -2))
    .where('month', '<=', usageMonth(now))
    .groupBy('module')
    .execute();
  return Object.fromEntries(rows.map((row) => [row.module, Number(row.visits)]));
}

/** Retain at most the current month and three preceding months. */
export async function pruneStaffUsage(now = new Date()): Promise<void> {
  await getDb()
    .deleteFrom('organisation.staff_usage')
    .where('month', '<', usageMonth(now, -3))
    .execute();
}
