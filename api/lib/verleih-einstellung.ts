import {
  getDb,
  inTransaction,
  lockResource,
  requireRowversion,
  toVersion,
  VersionConflictError,
} from './db';
import { getTaskDirectoryUsers } from './task-directory';
import { ValidationError } from './validation/errors';
export async function getVerleihEinstellung(): Promise<{ materialwart: string; etag: string }> {
  const row = await getDb()
    .selectFrom('organisation.verleih_einstellung')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return { materialwart: row.materialwart, etag: toVersion(row.version) };
}
export async function saveVerleihEinstellung(login: string, etag: string): Promise<void> {
  const users = login ? await getTaskDirectoryUsers() : [];
  if (login && !users.some((u) => u.login.toLowerCase() === login.toLowerCase()))
    throw new ValidationError({
      materialwart: 'Bitte ein aktives Stammeskonto aus der Liste auswählen.',
    });
  await inTransaction(async (trx) => {
    await lockResource(trx, 'inventur-verleih');
    const result = await trx
      .updateTable('organisation.verleih_einstellung')
      .set({ materialwart: login.toLowerCase() })
      .where('id', '=', 1)
      .where('version', '=', requireRowversion(etag))
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) throw new VersionConflictError();
  });
}
