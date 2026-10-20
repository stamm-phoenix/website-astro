import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';

/**
 * The changelog entries a person has seen (`organisation.staff_changelog_seen`, migration
 * `0034_staff_changelog_seen.sql`): the ID of the newest one, the same on every device. Stored per
 * `userId` of the Static Web Apps principal, with the login for reference.
 */

/** The newest seen ID, or `null` if the person has not opened the changelog yet. */
export async function getChangelogSeen(userId: string): Promise<string | null> {
  const row = await getDb()
    .selectFrom('organisation.staff_changelog_seen')
    .select('last_seen_id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.last_seen_id ?? null;
}

/**
 * Remembers `id` as seen and returns the ID that applies afterwards. An older ID never replaces a
 * newer one, so a device with an old page cannot make seen entries new again.
 */
export async function saveChangelogSeen(
  userId: string,
  login: string,
  id: string
): Promise<string> {
  return inTransaction(async (trx) => {
    // Two first saves of one person must not both insert
    await lockResource(trx, `staff-changelog-seen:${userId}`);
    const row = await trx
      .selectFrom('organisation.staff_changelog_seen')
      .select('last_seen_id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) {
      await trx
        .insertInto('organisation.staff_changelog_seen')
        .values({ user_id: userId, login, last_seen_id: id })
        .execute();
      return id;
    }
    if (row.last_seen_id >= id) return row.last_seen_id;
    await trx
      .updateTable('organisation.staff_changelog_seen')
      .set({ login, last_seen_id: id, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('user_id', '=', userId)
      .execute();
    return id;
  });
}
