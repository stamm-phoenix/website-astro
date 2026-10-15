import { getDb, getSqlErrorNumber } from './db';

/**
 * Whether the KJR grant is applied for a CampFlow Aktion (`organisation.aktion_ohne_zuschuss`,
 * migration `0020_aktion_ohne_zuschuss.sql`). Every Aktion gets it unless it is listed there:
 * external Aktionen whose registrations we only collect, or ones we decided not to apply for.
 * Without the grant an Aktion has no KJR deadline, and its Abrechnung shows income and
 * expenses only.
 */

const DUPLICATE_KEY = 2627;

/** IDs of the CampFlow Aktionen without KJR grant. */
export async function getAktionenOhneZuschuss(): Promise<Set<string>> {
  const rows = await getDb()
    .selectFrom('organisation.aktion_ohne_zuschuss')
    .select('campflow_id')
    .execute();
  return new Set(rows.map((row) => row.campflow_id));
}

/** Whether the KJR grant is applied for the CampFlow Aktion `campflowId`. */
export async function isZuschussfaehig(campflowId: string): Promise<boolean> {
  const row = await getDb()
    .selectFrom('organisation.aktion_ohne_zuschuss')
    .select('campflow_id')
    .where('campflow_id', '=', campflowId)
    .executeTakeFirst();
  return row === undefined;
}

/** Turns the KJR grant of an Aktion on or off; setting the current value changes nothing. */
export async function setZuschussfaehig(
  campflowId: string,
  zuschussfaehig: boolean,
  actor: string
): Promise<void> {
  if (zuschussfaehig) {
    await getDb()
      .deleteFrom('organisation.aktion_ohne_zuschuss')
      .where('campflow_id', '=', campflowId)
      .execute();
    return;
  }
  try {
    await getDb()
      .insertInto('organisation.aktion_ohne_zuschuss')
      .values({ campflow_id: campflowId, created_by: actor })
      .execute();
  } catch (error: unknown) {
    // Someone else switched it off at the same time
    if (getSqlErrorNumber(error) !== DUPLICATE_KEY) throw error;
  }
}
