import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { nextContentId } from './content-ids';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  requireVersion,
  toVersion,
} from './db';
import type { GruppenstundeTable } from './db-schema';
import type { GruppenstundeInput } from './validation/content';

/**
 * The Gruppenstunden in Azure SQL (`content.gruppenstunde`, migration
 * `0024_gruppenstunden_leitende.sql`).
 */

export interface Gruppenstunde {
  id: string;
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  ageRange: string;
  description: string;
}

export interface StaffGruppenstunde extends Gruppenstunde {
  etag: string;
}

function toGruppenstunde(row: Selectable<GruppenstundeTable>): StaffGruppenstunde {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    stufe: row.stufe,
    weekday: row.weekday,
    time: row.meeting_time,
    ageRange: row.age_range,
    location: row.location,
    description: row.description,
  };
}

function toColumns(input: GruppenstundeInput): {
  stufe: string;
  weekday: string;
  meeting_time: string;
  age_range: string;
  location: string;
  description: string;
} {
  return {
    stufe: input.stufe,
    weekday: input.weekday,
    meeting_time: input.time,
    age_range: input.ageRange,
    location: input.location,
    description: input.description,
  };
}

/** All Gruppenstunden in the order they were created, with their version. */
export async function getStaffGruppenstunden(): Promise<StaffGruppenstunde[]> {
  const rows = await getDb()
    .selectFrom('content.gruppenstunde')
    .selectAll()
    .orderBy('id')
    .execute();
  return rows.map(toGruppenstunde);
}

export async function getGruppenstunden(): Promise<Gruppenstunde[]> {
  return (await getStaffGruppenstunden()).map((item) => ({
    id: item.id,
    stufe: item.stufe,
    weekday: item.weekday,
    time: item.time,
    location: item.location,
    ageRange: item.ageRange,
    description: item.description,
  }));
}

export async function createGruppenstunde(
  input: GruppenstundeInput,
  actor: string
): Promise<string> {
  return inTransaction(async (trx) => {
    const id = await nextContentId(trx, 'content.gruppenstunde');
    await trx
      .insertInto('content.gruppenstunde')
      .values({ id, ...toColumns(input), updated_by: actor })
      .execute();
    return String(id);
  });
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('content.gruppenstunde')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves a Gruppenstunde if it still has the version `etag`. */
export async function updateGruppenstunde(
  id: number,
  input: GruppenstundeInput,
  etag: string,
  actor: string
): Promise<void> {
  const result = await getDb()
    .updateTable('content.gruppenstunde')
    .set({ ...toColumns(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) await notChanged(id);
}

/** Deletes a Gruppenstunde if it still has the version `etag`. */
export async function deleteGruppenstunde(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('content.gruppenstunde')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
}
