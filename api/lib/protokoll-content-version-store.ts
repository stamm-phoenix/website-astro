import { sql } from 'kysely';
import { getDb, inTransaction } from './db';

/**
 * Content versions of the protocol files (`organisation.protokoll_content_version`, migration
 * `0038_protokoll_content_version.sql`), so a new process does not download every file again.
 * A row is valid only while the file has the stored cTag.
 */
export interface StoredContentVersion {
  cTag: string;
  version: string;
}

// SQL Server accepts at most 2100 parameters per statement
const CHUNK = 500;

function chunks<T>(values: T[]): T[][] {
  return Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, index) =>
    values.slice(index * CHUNK, (index + 1) * CHUNK)
  );
}

/** All stored versions of a drive, by item ID. */
export async function readProtokollContentVersions(
  driveId: string
): Promise<Map<string, StoredContentVersion>> {
  const rows = await getDb()
    .selectFrom('organisation.protokoll_content_version')
    .select(['item_id', 'ctag', 'content_version'])
    .where('drive_id', '=', driveId)
    .execute();
  return new Map(
    rows.map((row) => [row.item_id, { cTag: row.ctag, version: row.content_version }])
  );
}

/**
 * Stores new or changed versions and removes the rows of `removed` files. Concurrent lists may
 * store the same rows: MERGE with HOLDLOCK neither inserts twice nor fails, and a row that is
 * already current is not written again.
 */
export async function saveProtokollContentVersions(
  driveId: string,
  changed: Map<string, StoredContentVersion>,
  removed: string[]
): Promise<void> {
  await inTransaction(async (trx) => {
    for (const part of chunks([...changed])) {
      await sql`
        MERGE organisation.protokoll_content_version WITH (HOLDLOCK) AS target
        USING (VALUES ${sql.join(
          part.map(([itemId, { cTag, version }]) => sql`(${itemId}, ${cTag}, ${version})`)
        )}) AS source (item_id, ctag, content_version)
        ON target.drive_id = ${driveId} AND target.item_id = source.item_id
        WHEN MATCHED AND (target.ctag <> source.ctag OR target.content_version <> source.content_version)
          THEN UPDATE SET ctag = source.ctag, content_version = source.content_version,
            updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED
          THEN INSERT (drive_id, item_id, ctag, content_version)
            VALUES (${driveId}, source.item_id, source.ctag, source.content_version);
      `.execute(trx);
    }
    for (const part of chunks(removed)) {
      await trx
        .deleteFrom('organisation.protokoll_content_version')
        .where('drive_id', '=', driveId)
        .where('item_id', 'in', part)
        .execute();
    }
  });
}
