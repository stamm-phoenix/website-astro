import { ValidationError } from './pflege-validation';
import { createHash } from 'node:crypto';
import { CONFIG } from './config';
import { getDb, inTransaction, lockResource, VersionConflictError } from './db';
import { getSharePointDriveItem } from './sharepoint-data-access';
import type { ProtokollDriveItem, ProtokollFields } from './protokolle';
export const PROTOKOLL_FIELD_NAMES = [
  'Status',
  'ErstelltVon',
  'Pruefnotiz',
  'FreigegebenVon',
  'FreigegebenAm',
  'FreigabeVersion',
  'Versand',
  'Termin',
] as const;
export function workflowFields(raw: ProtokollFields = {}): ProtokollFields {
  const fields: ProtokollFields = {};
  for (const name of PROTOKOLL_FIELD_NAMES) {
    const value = raw[name];
    if (typeof value === 'string' && value !== '') fields[name] = value;
    else if (value !== undefined && value !== null && value !== '')
      throw new Error('Unexpected protocol column type');
  }
  return fields;
}
/** Fail closed instead of turning unmigrated approvals/delivery reservations into archives. */
export async function assertProtokollImport(driveId: string): Promise<void> {
  const ids = [driveId];
  if (CONFIG.database.server === CONFIG.database.previewServer) ids.push('*preview*');
  const marker = await getDb()
    .selectFrom('organisation.protokoll_import')
    .select('drive_id')
    .where('drive_id', 'in', ids)
    .executeTakeFirst();
  if (!marker)
    throw new ValidationError({
      form: 'Die Protokoll-Metadaten müssen zuerst nach Azure SQL migriert werden.',
    });
}
function etag(version: Buffer, cTag?: string): string {
  return `"${version.toString('hex')}.${createHash('sha256')
    .update(cTag ?? '')
    .digest('hex')}"`;
}
export async function withProtokollMetadata(
  driveId: string,
  item: ProtokollDriveItem
): Promise<ProtokollDriveItem> {
  await assertProtokollImport(driveId);
  const row = await inTransaction(async (trx) => {
    await lockResource(trx, `protokoll:${driveId}:${item.id}`);
    let row = await trx
      .selectFrom('organisation.protokoll')
      .selectAll()
      .where('drive_id', '=', driveId)
      .where('item_id', '=', item.id)
      .executeTakeFirst();
    if (!row)
      row = await trx
        .insertInto('organisation.protokoll')
        .values({
          drive_id: driveId,
          item_id: item.id,
          fields: '{}',
          legacy_fields: null,
          legacy_etag: null,
        })
        .outputAll('inserted')
        .executeTakeFirstOrThrow();
    return row;
  });
  return {
    ...item,
    listItem: undefined,
    metadata: {
      fields: JSON.parse(row.fields) as ProtokollFields,
      etag: etag(row.version, item.cTag),
    },
  };
}
/** Conditional SQL writes, including mail reservations. No library columns are written. */
export async function updateProtokollMetadata(
  driveId: string,
  id: string,
  patch: ProtokollFields,
  expected: string,
  completion = false
): Promise<string> {
  const item = completion
    ? undefined
    : ((await getSharePointDriveItem(driveId, id)) as ProtokollDriveItem | undefined);
  if (!completion && !item) throw new VersionConflictError();
  return inTransaction(async (trx) => {
    await lockResource(trx, `protokoll:${driveId}:${id}`);
    const row = await trx
      .selectFrom('organisation.protokoll')
      .selectAll()
      .where('drive_id', '=', driveId)
      .where('item_id', '=', id)
      .executeTakeFirst();
    if (
      !row ||
      (completion
        ? !/^"[0-9a-f]{16}\.[0-9a-f]{64}"$/.test(expected) ||
          row.version.toString('hex') !== expected.slice(1, 17)
        : etag(row.version, item?.cTag) !== expected)
    )
      throw new VersionConflictError();
    const fields = { ...(JSON.parse(row.fields) as ProtokollFields), ...patch };
    const result = await trx
      .updateTable('organisation.protokoll')
      .set({ fields: JSON.stringify(fields) })
      .where('drive_id', '=', driveId)
      .where('item_id', '=', id)
      .where('version', '=', row.version)
      .output('inserted.version')
      .executeTakeFirst();
    if (!result) throw new VersionConflictError();
    return etag(result.version, item?.cTag);
  });
}
export async function createProtokollMetadata(
  driveId: string,
  id: string,
  fields: ProtokollFields
): Promise<void> {
  await assertProtokollImport(driveId);
  await inTransaction(async (trx) => {
    await lockResource(trx, `protokoll:${driveId}:${id}`);
    const row = await trx
      .selectFrom('organisation.protokoll')
      .selectAll()
      .where('drive_id', '=', driveId)
      .where('item_id', '=', id)
      .executeTakeFirst();
    // A parallel listing may already have registered the just-created file as an empty archive.
    if (row) {
      if (row.fields !== '{}' || row.legacy_fields !== null) throw new VersionConflictError();
      await trx
        .updateTable('organisation.protokoll')
        .set({ fields: JSON.stringify(fields) })
        .where('drive_id', '=', driveId)
        .where('item_id', '=', id)
        .where('version', '=', row.version)
        .execute();
    } else {
      await trx
        .insertInto('organisation.protokoll')
        .values({
          drive_id: driveId,
          item_id: id,
          fields: JSON.stringify(fields),
          legacy_fields: null,
          legacy_etag: null,
        })
        .execute();
    }
  });
}
