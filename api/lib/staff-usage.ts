import { sql } from 'kysely';
import { getDb, getSqlErrorNumber } from './db';
import { usageMonth } from './staff-usage-model';

const DUPLICATE_KEY = new Set([2601, 2627]);

/**
 * Counts one visit of a module in the current month, without a lock: an update of the row
 * does it atomically, and only the first visit of a month inserts it. When two first visits
 * race, the loser hits the primary key and counts with an update instead.
 */
export async function recordStaffUsage(module: string, now = new Date()): Promise<void> {
  const month = usageMonth(now);
  if (!(await countVisit(month, module))) {
    try {
      await getDb()
        .insertInto('organisation.staff_usage')
        .values({ month, module, visits: 1 })
        .execute();
    } catch (error: unknown) {
      if (!DUPLICATE_KEY.has(getSqlErrorNumber(error) ?? 0)) throw error;
      await countVisit(month, module);
    }
  }
  await pruneStaffUsageDaily(now);
}

/** Whether the row of this month and module existed and was counted. */
async function countVisit(month: string, module: string): Promise<boolean> {
  const result = await getDb()
    .updateTable('organisation.staff_usage')
    .set({ visits: sql<number>`visits + 1` })
    .where('month', '=', month)
    .where('module', '=', module)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** Current UTC calendar month and the preceding two months. Only aggregated totals leave the API. */
export async function getStaffUsage(now = new Date()): Promise<Record<string, number>> {
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

let lastPrunedDay: string | undefined;

/**
 * Prunes at most once per day and instance, after a visit was counted. Reading the totals
 * never needs it, because they only look at the last three months. A failed prune is tried
 * again with the next visit and never fails the visit that triggered it.
 */
export async function pruneStaffUsageDaily(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  if (lastPrunedDay === day) return;
  lastPrunedDay = day;
  try {
    await pruneStaffUsage(now);
  } catch {
    lastPrunedDay = undefined;
  }
}

/** For tests: forget that the instance pruned today. */
export function resetStaffUsagePruning(): void {
  lastPrunedDay = undefined;
}
