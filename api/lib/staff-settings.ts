import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';
import { pickStaffSettings } from './staff-settings-model';
import type { StaffSettings } from './staff-settings-model';

/**
 * Settings of the Leitendenbereich per person (`organisation.staff_settings`, migration
 * `0030_staff_settings.sql`): one JSON object per `userId` of the Static Web Apps principal, the
 * same on every device. Unknown keys are never stored.
 */

/** The saved settings; an empty object if the person has never saved any. */
export async function getStaffSettings(userId: string): Promise<StaffSettings> {
  const row = await getDb()
    .selectFrom('organisation.staff_settings')
    .select('settings')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? parseSettings(row.settings) : {};
}

function parseSettings(json: string): StaffSettings {
  try {
    return pickStaffSettings(JSON.parse(json));
  } catch {
    return {};
  }
}

/** Merges `changes` into the saved settings of a person and returns the result. */
export async function saveStaffSettings(
  userId: string,
  login: string,
  changes: StaffSettings
): Promise<StaffSettings> {
  return inTransaction(async (trx) => {
    // Two first saves of one person must not both insert
    await lockResource(trx, `staff-settings:${userId}`);
    const row = await trx
      .selectFrom('organisation.staff_settings')
      .select('settings')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    const settings = { ...(row ? parseSettings(row.settings) : {}), ...changes };
    const values = { login, settings: JSON.stringify(settings) };
    if (row) {
      await trx
        .updateTable('organisation.staff_settings')
        .set({ ...values, updated_at: sql<Date>`SYSUTCDATETIME()` })
        .where('user_id', '=', userId)
        .execute();
    } else {
      await trx
        .insertInto('organisation.staff_settings')
        .values({ user_id: userId, ...values })
        .execute();
    }
    return settings;
  });
}
