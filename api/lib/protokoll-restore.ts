import { getDb, lockResource } from './db';
import { PROTOKOLL_CUTOVER_LOCK } from './protokoll-cutover';
import { PROTOKOLL_FIELD_NAMES, workflowFields } from './protokoll-metadata';
import type { ProtokollDriveItem, ProtokollFields } from './protokolle';

export interface ProtokollSourceAdapter {
  read(id: string): Promise<ProtokollDriveItem>;
  write(id: string, fields: Record<string, string | null>, etag: string): Promise<void>;
}

/** Frozen SQL snapshot → conditional Graph writes. Partial failures are safely resumable. */
export async function writeProtokollSource(
  driveId: string,
  items: ProtokollDriveItem[],
  source: ProtokollSourceAdapter,
  cleanup = false
): Promise<void> {
  // No automatic SQL retry: Graph side effects must not be replayed.
  await getDb()
    .transaction()
    .execute(async (trx) => {
      await lockResource(trx, PROTOKOLL_CUTOVER_LOCK);
      const state = await trx
        .selectFrom('organisation.protokoll_cutover')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      if (state.mode !== 'frozen' || !state.sql_started)
        throw new Error('RESTORE_REQUIRES_SQL_FREEZE');
      const rows = await trx
        .selectFrom('organisation.protokoll')
        .selectAll()
        .where('drive_id', '=', driveId)
        .execute();
      const ids = new Set(items.map((item) => item.id));
      // Never silently discard SQL-only workflow decisions for a missing file.
      if (!cleanup && rows.some((row) => !ids.has(row.item_id) && row.fields !== '{}'))
        throw new Error('RESTORE_FILE_MISSING');
      for (const item of items) {
        const row = rows.find((row) => row.item_id === item.id);
        if (!row) continue;
        const fields = cleanup ? {} : workflowFields(JSON.parse(row.fields) as ProtokollFields);
        const expected = JSON.stringify(fields);
        const fresh = await source.read(item.id);
        const current = JSON.stringify(workflowFields(fresh.listItem?.fields));
        // Original legacy values or a previously completed write only; refuse foreign changes.
        if (
          current !== (row.legacy_fields ?? '{}') &&
          current !== expected &&
          !(row.source_cleared && current === '{}')
        )
          throw new Error('RESTORE_SOURCE_CHANGED');
        if (!fresh.listItem?.eTag) throw new Error('RESTORE_SOURCE_VERSION_MISSING');
        if (current !== expected) {
          await source.write(
            item.id,
            Object.fromEntries(PROTOKOLL_FIELD_NAMES.map((key) => [key, fields[key] ?? null])),
            fresh.listItem.eTag
          );
        }
        const verified = await source.read(item.id);
        if (JSON.stringify(workflowFields(verified.listItem?.fields)) !== expected)
          throw new Error('RESTORE_VERIFICATION_FAILED');
        // Commit per item outside the gate transaction, so a crash after a Graph patch is resumable.
        await getDb()
          .updateTable('organisation.protokoll')
          .set(
            cleanup
              ? { source_cleared: true }
              : {
                  legacy_fields: expected,
                  legacy_etag: verified.listItem?.eTag ?? null,
                  source_cleared: false,
                }
          )
          .where('drive_id', '=', driveId)
          .where('item_id', '=', item.id)
          .where('version', '=', row.version)
          .execute();
      }
    });
}
