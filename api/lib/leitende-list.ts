import type { HttpResponseInit } from '@azure/functions';
import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import { deleteBlob, deleteBlobs, getBlob, listBlobs, putBlob } from './blob-storage';
import { nextContentId } from './content-ids';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  parseId,
  requireVersion,
  toVersion,
} from './db';
import type { Database, LeitendeTable } from './db-schema';
import type { LeitendeInput } from './validation/content';
import { sortTeams } from './validation/constants';
import {
  newPhotoFileName,
  photoBlobName,
  photoContentType,
  toStoredPhoto,
} from './leitende-photos';

/**
 * The Leitende in Azure SQL (`content.leitende` with their teams in `content.leitende_team`,
 * migration `0024_gruppenstunden_leitende.sql`). Photos are stored in Blob Storage under
 * `leitende/<id>/<foto>`.
 */

export interface Leitende {
  id: string;
  name: string;
  teams: string[];
  telephone?: string | undefined;
  street?: string | undefined;
  city?: string | undefined;
  imageFileName?: string | undefined;
  hasImage: boolean;
}

export interface StaffLeitende {
  id: string;
  etag: string;
  name: string;
  teams: string[];
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  hasImage: boolean;
}

interface LeitendeRow {
  row: Selectable<LeitendeTable>;
  teams: string[];
}

async function loadRows(): Promise<LeitendeRow[]> {
  // One statement, so a person's version and teams always come from the same state
  const rows = await getDb()
    .selectFrom('content.leitende as l')
    .leftJoin('content.leitende_team as t', 't.leitende_id', 'l.id')
    .selectAll('l')
    .select('t.team')
    .orderBy('l.id')
    .execute();
  const people = new Map<number, LeitendeRow>();
  for (const { team, ...row } of rows) {
    const person = people.get(row.id) ?? { row, teams: [] };
    if (team !== null) person.teams.push(team);
    people.set(row.id, person);
  }
  return [...people.values()].map(({ row, teams }) => ({ row, teams: sortTeams(teams) }));
}

export async function getLeitende(): Promise<Leitende[]> {
  return (await loadRows()).map(({ row, teams }) => ({
    id: String(row.id),
    name: row.name,
    teams,
    telephone: row.phone || undefined,
    street: row.street || undefined,
    city: row.postal_code && row.city ? `${row.postal_code} ${row.city}` : undefined,
    imageFileName: row.photo ?? undefined,
    hasImage: row.photo !== null,
  }));
}

/** All Leitende with their contact details and version, for the edit module. */
export async function getStaffLeitende(): Promise<StaffLeitende[]> {
  return (await loadRows()).map(({ row, teams }) => ({
    id: String(row.id),
    etag: toVersion(row.version),
    name: row.name,
    teams,
    phone: row.phone,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    hasImage: row.photo !== null,
  }));
}

/** The teams to choose from: Vorstand, the Stufen, then the others by name. */
export async function getTeams(): Promise<string[]> {
  const rows = await getDb().selectFrom('content.team').select('name').execute();
  return sortTeams(rows.map((row) => row.name));
}

function toColumns(input: LeitendeInput): {
  name: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
} {
  return {
    name: input.name,
    phone: input.phone,
    street: input.street,
    postal_code: input.postalCode,
    city: input.city,
  };
}

async function writeTeams(
  trx: Transaction<Database>,
  id: number,
  teams: readonly string[]
): Promise<void> {
  await trx.deleteFrom('content.leitende_team').where('leitende_id', '=', id).execute();
  if (teams.length === 0) return;
  await trx
    .insertInto('content.leitende_team')
    .values(teams.map((team) => ({ leitende_id: id, team })))
    .execute();
}

export async function createLeitende(input: LeitendeInput, actor: string): Promise<string> {
  return inTransaction(async (trx) => {
    const id = await nextContentId(trx, 'content.leitende');
    await trx
      .insertInto('content.leitende')
      .values({ id, ...toColumns(input), updated_by: actor })
      .execute();
    await writeTeams(trx, id, input.teams);
    return String(id);
  });
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('content.leitende')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves a person with their teams if it still has the version `etag`. */
export async function updateLeitende(
  id: number,
  input: LeitendeInput,
  etag: string,
  actor: string
): Promise<void> {
  const updated = await inTransaction(async (trx) => {
    const result = await trx
      .updateTable('content.leitende')
      .set({ ...toColumns(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('id', '=', id)
      .where('version', '=', requireVersion(etag))
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return false;
    await writeTeams(trx, id, input.teams);
    return true;
  });
  if (!updated) await notChanged(id);
}

/** Deletes a person and their photo if it still has the version `etag`. */
export async function deleteLeitende(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('content.leitende')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
  await removeFiles(() => deleteBlobs(`leitende/${id}/`));
}

/** Files younger than this may belong to a photo being saved right now. */
export const ORPHAN_MIN_AGE_MS = 10 * 60_000;

/**
 * Deletes photo files no person refers to any more, e.g. after a deletion whose cleanup failed.
 * Only files older than `ORPHAN_MIN_AGE_MS`: uploads store a file before they save its name. IDs are never reused, so a file of a deleted person never becomes current.
 */
export async function deleteOrphanedPhotos(now: number = Date.now()): Promise<number> {
  const [files, rows] = await Promise.all([
    listBlobs('leitende/'),
    getDb().selectFrom('content.leitende').select(['id', 'photo']).execute(),
  ]);
  const current = new Set(
    rows.flatMap((row) => (row.photo ? [photoBlobName(row.id, row.photo)] : []))
  );
  let deleted = 0;
  for (const file of files) {
    if (current.has(file.name) || now - file.lastModified.getTime() < ORPHAN_MIN_AGE_MS) continue;
    await deleteBlob(file.name);
    deleted++;
  }
  return deleted;
}

/**
 * Deletes files after the rows were changed. The change is saved already, so a failure is only
 * logged; `deleteOrphanedPhotos` runs after every change and removes what was left.
 */
async function removeFiles(work: () => Promise<unknown>): Promise<void> {
  for (const step of [work, () => deleteOrphanedPhotos()]) {
    try {
      await step();
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          scope: 'leitende-photos',
          warning: 'Photo files could not be deleted; the next change of a person removes them',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}

async function loadPhoto(id: number): Promise<{ photo: string | null; version: Buffer }> {
  const row = await getDb()
    .selectFrom('content.leitende')
    .select(['photo', 'version'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new RecordNotFoundError();
  return row;
}

/**
 * Replaces the photo of a person. With `etag`, only if the person still has that version, so
 * a photo is never attached to a person changed in the meantime.
 */
export async function setLeitendePhoto(
  id: number,
  bytes: Uint8Array,
  etag: string | undefined,
  actor: string
): Promise<string> {
  const current = await loadPhoto(id);
  const expected = etag === undefined ? current.version : requireVersion(etag);
  const file = newPhotoFileName();
  await putBlob(photoBlobName(id, file), await toStoredPhoto(bytes), photoContentType(file));
  const result = await getDb()
    .updateTable('content.leitende')
    .set({ photo: file, updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', expected)
    .output('inserted.version')
    .executeTakeFirst();
  if (!result) {
    await removeFiles(() => deleteBlob(photoBlobName(id, file)));
    return notChanged(id);
  }
  const previous = current.photo;
  if (previous && previous !== file) {
    await removeFiles(() => deleteBlob(photoBlobName(id, previous)));
  }
  return toVersion(result.version);
}

/** Removes the photo of a person; with `etag` only if the person still has that version. */
export async function removeLeitendePhoto(
  id: number,
  etag: string | undefined,
  actor: string
): Promise<string> {
  const current = await loadPhoto(id);
  const expected = etag === undefined ? current.version : requireVersion(etag);
  const result = await getDb()
    .updateTable('content.leitende')
    .set({ photo: null, updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', expected)
    .output('inserted.version')
    .executeTakeFirst();
  if (!result) return notChanged(id);
  const previous = current.photo;
  if (previous) await removeFiles(() => deleteBlob(photoBlobName(id, previous)));
  return toVersion(result.version);
}

/** The stored photo of a person as a response, or undefined without one. */
export async function serveLeitendePhoto(id: string): Promise<HttpResponseInit | undefined> {
  const numericId = parseId(id);
  if (numericId === undefined) return undefined;
  const row = await getDb()
    .selectFrom('content.leitende')
    .select('photo')
    .where('id', '=', numericId)
    .executeTakeFirst();
  if (!row?.photo) return undefined;
  const bytes = await getBlob(photoBlobName(numericId, row.photo));
  if (!bytes) return undefined;
  return {
    status: 200,
    headers: {
      'Content-Type': photoContentType(row.photo),
      'Content-Length': String(bytes.length),
    },
    body: new Uint8Array(bytes),
  };
}
