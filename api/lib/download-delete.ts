import { sql } from 'kysely';
import { inTransaction, lockResource, RecordNotFoundError, VersionConflictError } from './db';

/** Serialize with action attachment writes before taking any action/download row locks. */
export async function deleteDownloadRow(
  id: string,
  version: Buffer,
  actor: string
): Promise<{ file_key: string }> {
  return inTransaction(async (trx) => {
    await lockResource(trx, 'content.aktion-download');
    const download = await trx
      .selectFrom('content.download')
      .select(['version', 'file_key'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!download) throw new RecordNotFoundError();
    if (!download.version.equals(version)) throw new VersionConflictError();
    // The shared lock prevents links being added or removed between this update and cascade.
    // Updating the source row also serializes against reviews holding UPDLOCK/HOLDLOCK.
    await trx
      .updateTable('content.aktion')
      .set({ updated_at: sql<Date>`SYSUTCDATETIME()`, updated_by: actor })
      .where(
        'id',
        'in',
        trx.selectFrom('content.aktion_download').select('aktion_id').where('download_id', '=', id)
      )
      .execute();
    const deleted = await trx
      .deleteFrom('content.download')
      .where('id', '=', id)
      .where('version', '=', version)
      .output('deleted.file_key')
      .executeTakeFirst();
    if (!deleted) throw new VersionConflictError();
    return deleted;
  });
}
