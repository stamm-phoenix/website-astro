import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { RecordNotFoundError, VersionConflictError, getDb, requireVersion, toVersion } from './db';
import type { WeiterePersonTable } from './db-schema';
import type { WeiterePersonInput } from './pflege-validation';
import type { WeiterePerson } from './protokoll-editor-model';

/**
 * Altleitende and others who often take part but are not in the Entra group of the leaders
 * (#301, `organisation.person`, migration `0017_weitere_personen.sql`). The Protokoll-Editor
 * offers the active ones next to the leaders.
 */

function toPerson(row: Selectable<WeiterePersonTable>): WeiterePerson {
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    gruppe: row.gruppe,
    aktiv: row.aktiv,
    etag: toVersion(row.version),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

/** All people of the list, active ones first, then by name. */
export async function getWeiterePersonen(): Promise<WeiterePerson[]> {
  const rows = await getDb().selectFrom('organisation.person').selectAll().execute();
  return rows
    .map(toPerson)
    .sort((a, b) => Number(b.aktiv) - Number(a.aktiv) || a.name.localeCompare(b.name, 'de'));
}

export async function createWeiterePerson(
  input: WeiterePersonInput,
  actor: string
): Promise<number> {
  const { id } = await getDb()
    .insertInto('organisation.person')
    .values({ ...input, updated_by: actor })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return id;
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('organisation.person')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves a person if it still has the version `etag`. */
export async function updateWeiterePerson(
  id: number,
  input: WeiterePersonInput,
  etag: string,
  actor: string
): Promise<void> {
  const result = await getDb()
    .updateTable('organisation.person')
    .set({ ...input, updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) await notChanged(id);
}

/** Deletes a person if it still has the version `etag`; old minutes keep the name. */
export async function deleteWeiterePerson(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('organisation.person')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
}
