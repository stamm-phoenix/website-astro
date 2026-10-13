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

/** Transactional, lossless one-time import. Repeated imports never overwrite SQL edits. */
export async function importProtokollMetadata(
  driveId: string,
  items: ProtokollDriveItem[]
): Promise<number> {
  const files = items.filter((item) => isProtokollFile(item, CONFIG.protokolle.folderPath));
  return inTransaction(async (trx) => {
    await lockResource(trx, `protokoll-import:${driveId}`);
    const completed = await trx
      .selectFrom('organisation.protokoll_import')
      .select('drive_id')
      .where('drive_id', '=', driveId)
      .executeTakeFirst();
    if (completed) return 0;
    for (const item of files) {
      const source = workflowFields(item.listItem?.fields);
      const legacy = JSON.stringify(source);
      const fields = JSON.stringify(importedFields(item, source));
      await trx
        .insertInto('organisation.protokoll')
        .values({
          drive_id: driveId,
          item_id: item.id,
          fields,
          legacy_fields: legacy,
          legacy_etag: item.listItem?.eTag ?? null,
        })
        .execute();
      const saved = await trx
        .selectFrom('organisation.protokoll')
        .select(['fields', 'legacy_fields'])
        .where('drive_id', '=', driveId)
        .where('item_id', '=', item.id)
        .executeTakeFirstOrThrow();
      if (saved.fields !== fields || saved.legacy_fields !== legacy)
        throw new Error('Protocol import verification failed');
    }
    await trx.insertInto('organisation.protokoll_import').values({ drive_id: driveId }).execute();
    return files.length;
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
    if (fields === '{}') continue;
    const saved = await getDb()
      .selectFrom('organisation.protokoll')
      .select('legacy_fields')
      .where('drive_id', '=', driveId)
      .where('item_id', '=', item.id)
      .executeTakeFirst();
    if (!saved || saved.legacy_fields !== fields)
      throw new Error(`Source metadata changed or missing SQL copy: ${item.id}`);
  }
}
