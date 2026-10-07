import { createHash } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { getDb, getSqlErrorNumber, inTransaction, lockResource, toDateString } from './db';
import type { Db } from './db';
import type { HelperRole } from './nikolaus-einteilung';
import type { EinteilungSaveInput } from './pflege-validation';
import { NikolausStateConflictError } from './nikolaus-state';
import { EINTEILUNG_LOCK as PLAN_LOCK, assertTeamsConfigured } from './nikolaus-settings';

/** One assignment of the Einteilung: a person on one day. */
export interface EinteilungRow {
  id: string;
  personId: string;
  /** Current name of the person. */
  name: string;
  date: string;
  /** Team name or `Küche`. */
  team: string;
  role: HelperRole;
  fixed: boolean;
}

type EinteilungEntry = EinteilungSaveInput['assignments'][number];

/** SQL Server: the row references a helper that was deleted in the meantime. */
const FOREIGN_KEY_VIOLATION = 547;

export async function getEinteilungRows(db: Db = getDb()): Promise<EinteilungRow[]> {
  const rows = await db
    .selectFrom('nikolaus.assignment as a')
    .innerJoin('nikolaus.helper as h', 'h.id', 'a.helper_id')
    .select(['a.helper_id', 'a.date', 'a.team', 'a.role', 'a.fixed', 'h.name'])
    .orderBy('a.date')
    .orderBy('a.helper_id')
    .execute();
  return rows.map((row) => {
    const date = toDateString(row.date);
    return {
      id: `einteilung:${date}:${row.helper_id}`,
      personId: String(row.helper_id),
      name: row.name.trim(),
      date,
      team: row.team,
      role: row.role as HelperRole,
      fixed: row.fixed,
    };
  });
}

/** Fingerprint of the planned content; saving compares it to detect concurrent changes. */
export function getEinteilungVersion(rows: Omit<EinteilungRow, 'name'>[]): string {
  const parts = rows
    .map((row) => JSON.stringify([row.id, row.personId, row.date, row.team, row.role, row.fixed]))
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

async function replaceAll(trx: Transaction<Database>, entries: EinteilungEntry[]): Promise<void> {
  await trx.deleteFrom('nikolaus.assignment').execute();
  // Batches stay below the limit of 2100 parameters per statement
  for (let index = 0; index < entries.length; index += 300) {
    await trx
      .insertInto('nikolaus.assignment')
      .values(
        entries.slice(index, index + 300).map((entry) => ({
          helper_id: Number(entry.personId),
          date: entry.date,
          team: entry.team,
          role: entry.role,
          fixed: entry.fixed,
        }))
      )
      .execute();
  }
}

/**
 * Replaces the whole Einteilung in one transaction, if nobody saved another one since the
 * caller loaded `expectedVersion`. Saving the same plan again changes nothing.
 */
export async function saveEinteilung(
  entries: EinteilungEntry[],
  expectedVersion: string
): Promise<void> {
  const desired = entries.map((entry) => ({
    ...entry,
    id: `einteilung:${entry.date}:${entry.personId}`,
  }));
  try {
    await inTransaction(async (trx) => {
      await lockResource(trx, PLAN_LOCK);
      await assertTeamsConfigured(trx, entries);
      const current = await getEinteilungRows(trx);
      if (getEinteilungVersion(desired) === getEinteilungVersion(current)) return;
      if (getEinteilungVersion(current) !== expectedVersion) throw new NikolausStateConflictError();
      await replaceAll(trx, entries);
    });
  } catch (error: unknown) {
    // A helper of the plan was deleted while saving
    if (getSqlErrorNumber(error) === FOREIGN_KEY_VIOLATION) throw new NikolausStateConflictError();
    throw error;
  }
}
