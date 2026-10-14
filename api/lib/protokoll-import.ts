import { PROTOKOLL_CUTOVER_LOCK } from './protokoll-cutover';
import { getDb, inTransaction, lockResource } from './db';
import { isProtokollFile } from './protokolle';
import type { ProtokollDriveItem, ProtokollFields } from './protokolle';
import { CONFIG } from './config';
import { workflowFields } from './protokoll-metadata';

/** Upgrade only an exact legacy content-tag match, keeping the untouched source snapshot. */
function importedFields(item: ProtokollDriveItem, source: ProtokollFields): ProtokollFields {
  const fields = { ...source };
  if (!item.contentVersion || !item.cTag) return fields;
  if (fields.FreigabeVersion === item.cTag) fields.FreigabeVersion = item.contentVersion;
  if (fields.Termin) {
    try {
      const value: unknown = JSON.parse(fields.Termin);
      if (
        value &&
        typeof value === 'object' &&
        'sourceVersion' in value &&
        value.sourceVersion === item.cTag
      ) {
        fields.Termin = JSON.stringify({ ...value, sourceVersion: item.contentVersion });
      }
    } catch {
      /* Preserve malformed legacy values exactly, for manual review. */
    }
  }
  return fields;
}

/** Frozen-source reconciliation. Preserve SQL edits and replace complete snapshots, including clears. */
export async function importProtokollMetadata(
  driveId: string,
  items: ProtokollDriveItem[]
): Promise<number> {
  const files = items.filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath));
  return inTransaction(async (trx) => {
    await lockResource(trx, PROTOKOLL_CUTOVER_LOCK);
    const state = await trx
      .selectFrom('organisation.protokoll_cutover')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    if (state.mode !== 'frozen' || state.sql_started)
      throw new Error('IMPORT_REQUIRES_INITIAL_FREEZE');
    const completed = await trx
      .selectFrom('organisation.protokoll_import')
      .select('drive_id')
      .where('drive_id', '=', driveId)
      .executeTakeFirst();
    let changed = 0;
    for (const item of files) {
      const source = workflowFields(item.listItem?.fields);
      const legacy = JSON.stringify(source);
      const fields = JSON.stringify(importedFields(item, source));
      const previous = await trx
        .selectFrom('organisation.protokoll')
        .selectAll()
        .where('drive_id', '=', driveId)
        .where('item_id', '=', item.id)
        .executeTakeFirst();
      if (previous?.legacy_fields === legacy) continue;
      if (previous) {
        if (previous.fields !== previous.imported_fields)
          throw new Error('SQL_CHANGED_SINCE_IMPORT');
        await trx
          .updateTable('organisation.protokoll')
          .set({
            fields,
            imported_fields: fields,
            legacy_fields: legacy,
            legacy_etag: item.listItem?.eTag ?? null,
          })
          .where('drive_id', '=', driveId)
          .where('item_id', '=', item.id)
          .where('version', '=', previous.version)
          .execute();
      } else {
        await trx
          .insertInto('organisation.protokoll')
          .values({
            drive_id: driveId,
            item_id: item.id,
            fields,
            imported_fields: fields,
            legacy_fields: legacy,
            legacy_etag: item.listItem?.eTag ?? null,
          })
          .execute();
      }
      changed++;
      const saved = await trx
        .selectFrom('organisation.protokoll')
        .select(['fields', 'legacy_fields'])
        .where('drive_id', '=', driveId)
        .where('item_id', '=', item.id)
        .executeTakeFirstOrThrow();
      if (saved.fields !== fields || saved.legacy_fields !== legacy)
        throw new Error('Protocol import verification failed');
    }
    if (!completed)
      await trx.insertInto('organisation.protokoll_import').values({ drive_id: driveId }).execute();
    return changed;
  });
}

/** Exact comparison with the retained source snapshot, not mutable current workflow fields. */
export async function verifyProtokollImport(
  driveId: string,
  items: ProtokollDriveItem[]
): Promise<void> {
  const marker = await getDb()
    .selectFrom('organisation.protokoll_import')
    .select('drive_id')
    .where('drive_id', '=', driveId)
    .executeTakeFirst();
  if (!marker) throw new Error('Protocol import not complete');
  for (const item of items.filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath))) {
    const fields = JSON.stringify(workflowFields(item.listItem?.fields));

    const saved = await getDb()
      .selectFrom('organisation.protokoll')
      .select(['legacy_fields', 'source_cleared'])
      .where('drive_id', '=', driveId)
      .where('item_id', '=', item.id)
      .executeTakeFirst();
    if (
      (!saved && fields !== '{}') ||
      (saved && (saved.source_cleared ? '{}' : (saved.legacy_fields ?? '{}')) !== fields)
    )
      throw new Error(`Source metadata changed or missing SQL copy: ${item.id}`);
  }
}
