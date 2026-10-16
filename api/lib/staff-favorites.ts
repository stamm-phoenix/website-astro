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
  if (!row) return null;
  const modules: unknown = JSON.parse(row.modules);
  return Array.isArray(modules)
    ? modules.filter((module): module is string => typeof module === 'string')
    : [];
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
