import type { Selectable, Updateable } from 'kysely';
import type { HelperTable } from './db-schema';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  parseId,
  parseStringList,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Db } from './db';
import type { HelperRole } from './nikolaus-einteilung';
import { HELPER_ROLES } from './nikolaus-einteilung';
import type { HelperInput } from './pflege-validation';

/** A helper of the Nikolausdienst. */
export interface Helper extends HelperInput {
  id: string;
  etag: string;
  /** Stufen whose suggestion from the Stufen-Abgleich was rejected; not part of the form. */
  rejectedStufen: string[];
}

function mapHelper(
  row: Selectable<HelperTable>,
  availability: Record<string, HelperRole[]>
): Helper {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    name: row.name.trim(),
    availability,
    positiveTags: parseStringList(row.positive_tags),
    negativeTags: parseStringList(row.negative_tags),
    notes: row.notes,
    rejectedStufen: parseStringList(row.rejected_stufen),
  };
}

/** Availability per helper ID, roles in the order of `HELPER_ROLES`. */
async function loadAvailability(
  db: Db,
  helperId?: number
): Promise<Map<number, Record<string, HelperRole[]>>> {
  let query = db.selectFrom('nikolaus.helper_availability').selectAll();
  if (helperId !== undefined) query = query.where('helper_id', '=', helperId);
  const byHelper = new Map<number, Record<string, Set<string>>>();
  for (const row of await query.execute()) {
    const dates = byHelper.get(row.helper_id) ?? {};
    const date = toDateString(row.date);
    (dates[date] ??= new Set()).add(row.role);
    byHelper.set(row.helper_id, dates);
  }
  return new Map(
    [...byHelper].map(([id, dates]) => [
      id,
      Object.fromEntries(
        Object.keys(dates)
          .sort()
          .map((date) => [date, HELPER_ROLES.filter((role) => dates[date].has(role))])
      ),
    ])
  );
}

/** All helpers, sorted by name. */
export async function getHelpers(): Promise<Helper[]> {
  const db = getDb();
  const [rows, availability] = await Promise.all([
    db.selectFrom('nikolaus.helper').selectAll().execute(),
    loadAvailability(db),
  ]);
  return rows
    .map((row) => mapHelper(row, availability.get(row.id) ?? {}))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function getHelper(id: string): Promise<Helper | undefined> {
  const numericId = parseId(id);
  if (numericId === undefined) return undefined;
  const db = getDb();
  const row = await db
    .selectFrom('nikolaus.helper')
    .selectAll()
    .where('id', '=', numericId)
    .executeTakeFirst();
  if (!row) return undefined;
  return mapHelper(row, (await loadAvailability(db, numericId)).get(numericId) ?? {});
}

function toColumns(input: HelperInput) {
  return {
    name: input.name,
    notes: input.notes,
    positive_tags: JSON.stringify(input.positiveTags),
    negative_tags: JSON.stringify(input.negativeTags),
  };
}

function availabilityRows(helperId: number, input: HelperInput) {
  return Object.entries(input.availability).flatMap(([date, roles]) =>
    roles.map((role) => ({ helper_id: helperId, date, role }))
  );
}

/**
 * Changes the helper row; with a version only if it still matches.
 * Without a version the change is unconditional (forms of older clients send none).
 */
async function updateRow(
  db: Db,
  id: number,
  etag: string | undefined,
  values: Updateable<HelperTable>
): Promise<void> {
  let query = db.updateTable('nikolaus.helper').set(values).where('id', '=', id);
  if (etag !== undefined) query = query.where('version', '=', requireVersion(etag));
  const result = await query.executeTakeFirst();
  if (Number(result.numUpdatedRows) > 0) return;
  const exists = await db
    .selectFrom('nikolaus.helper')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/**
 * Updates the fields set by the Stufen-Abgleich. They are not part of `toColumns`, so saving
 * the helper form never overwrites them.
 */
export async function updateHelperStufen(
  id: string,
  update: { negativeTags?: string[]; rejectedStufen?: string[] },
  etag?: string
): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const values: Updateable<HelperTable> = {};
  if (update.negativeTags) values.negative_tags = JSON.stringify(update.negativeTags);
  if (update.rejectedStufen) values.rejected_stufen = JSON.stringify(update.rejectedStufen);
  await updateRow(getDb(), numericId, etag, values);
}

export async function createHelper(input: HelperInput): Promise<string> {
  return inTransaction(async (trx) => {
    const { id } = await trx
      .insertInto('nikolaus.helper')
      .values(toColumns(input))
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const rows = availabilityRows(id, input);
    if (rows.length > 0)
      await trx.insertInto('nikolaus.helper_availability').values(rows).execute();
    return String(id);
  });
}

export async function updateHelper(id: string, input: HelperInput, etag?: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  await inTransaction(async (trx) => {
    await updateRow(trx, numericId, etag, toColumns(input));
    await trx
      .deleteFrom('nikolaus.helper_availability')
      .where('helper_id', '=', numericId)
      .execute();
    const rows = availabilityRows(numericId, input);
    if (rows.length > 0)
      await trx.insertInto('nikolaus.helper_availability').values(rows).execute();
  });
}

/** Deletes a helper; availability and Einteilung go with them. */
export async function deleteHelper(id: string, etag?: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const db = getDb();
  let query = db.deleteFrom('nikolaus.helper').where('id', '=', numericId);
  if (etag !== undefined) query = query.where('version', '=', requireVersion(etag));
  const result = await query.executeTakeFirst();
  if (Number(result.numDeletedRows) > 0) return;
  const exists = await db
    .selectFrom('nikolaus.helper')
    .select('id')
    .where('id', '=', numericId)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}
