import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';

/**
 * Favorites of the Leitendenbereich (`organisation.staff_favorites`, migration
 * `0028_staff_favorites.sql`): the module paths a logged-in person pins to the start page, the
 * same on every device. Stored per `userId` of the Static Web Apps principal.
 */

/** The saved module paths, or `null` if the person has never saved favorites. */
export async function getStaffFavorites(userId: string): Promise<string[] | null> {
  const row = await getDb()
    .selectFrom('organisation.staff_favorites')
    .select('modules')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? parseModules(row.modules) : null;
}

function parseModules(json: string): string[] {
  const modules: unknown = JSON.parse(json);
  return Array.isArray(modules)
    ? modules.filter((module): module is string => typeof module === 'string')
    : [];
}

/**
 * Takes over favorites a browser kept before they moved here, but only if the person has none
 * saved yet; returns the favorites that apply afterwards.
 */
export async function takeOverStaffFavorites(
  userId: string,
  login: string,
  modules: string[]
): Promise<string[]> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `staff-favorites:${userId}`);
    const row = await trx
      .selectFrom('organisation.staff_favorites')
      .select('modules')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    // Saved meanwhile, e.g. on another device: that newer choice wins over the old browser one
    if (row) return parseModules(row.modules);
    await trx
      .insertInto('organisation.staff_favorites')
      .values({ user_id: userId, login, modules: JSON.stringify(modules) })
      .execute();
    return modules;
  });
}

/** Replaces the favorites of a person; the last save wins. */
export async function saveStaffFavorites(
  userId: string,
  login: string,
  modules: string[]
): Promise<void> {
  const values = { login, modules: JSON.stringify(modules) };
  await inTransaction(async (trx) => {
    // Two first saves of one person must not both insert
    await lockResource(trx, `staff-favorites:${userId}`);
    const { numUpdatedRows } = await trx
      .updateTable('organisation.staff_favorites')
      .set({ ...values, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    if (numUpdatedRows === 0n) {
      await trx
        .insertInto('organisation.staff_favorites')
        .values({ user_id: userId, ...values })
        .execute();
    }
  });
}
