import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';

/**
 * Recently used areas of the Leitendenbereich (`organisation.staff_recent`, migration
 * `0032_staff_recent.sql`): the module paths a logged-in person opened last, the latest first, the
 * same on every device. Stored per `userId` of the Static Web Apps principal.
 */

/** How many areas are kept; more than the start page and the bar on the phone show. */
export const MAX_RECENT = 8;

/** The module paths, the latest first; empty if the person has not opened a module yet. */
export async function getStaffRecent(userId: string): Promise<string[]> {
  const row = await getDb()
    .selectFrom('organisation.staff_recent')
    .select('modules')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? parseModules(row.modules) : [];
}

function parseModules(json: string): string[] {
  try {
    const modules: unknown = JSON.parse(json);
    return Array.isArray(modules)
      ? modules.filter((module): module is string => typeof module === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Puts `module` first and returns the list as saved; read and written in one transaction. */
export async function addStaffRecent(
  userId: string,
  login: string,
  module: string
): Promise<string[]> {
  return inTransaction(async (trx) => {
    // Two visits of one person at once must not lose one or both insert
    await lockResource(trx, `staff-recent:${userId}`);
    const row = await trx
      .selectFrom('organisation.staff_recent')
      .select('modules')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    const previous = row ? parseModules(row.modules) : [];
    const modules = [module, ...previous.filter((entry) => entry !== module)].slice(0, MAX_RECENT);
    // Opening the latest area again changes nothing
    if (row && previous[0] === module && previous.length === modules.length) return previous;
    const values = { login, modules: JSON.stringify(modules) };
    if (row) {
      await trx
        .updateTable('organisation.staff_recent')
        .set({ ...values, updated_at: sql<Date>`SYSUTCDATETIME()` })
        .where('user_id', '=', userId)
        .execute();
    } else {
      await trx
        .insertInto('organisation.staff_recent')
        .values({ user_id: userId, ...values })
        .execute();
    }
    return modules;
  });
}
