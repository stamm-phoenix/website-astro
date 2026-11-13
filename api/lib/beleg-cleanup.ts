import { getDb } from './db';
import { deleteOrphanedBelegPhotos } from './beleg-photos';

/**
 * Deletes the files of the changed receipt after its rows were changed. The change is saved
 * already, so a failure is only logged; then the whole container is swept for files no receipt
 * refers to any more. The sweep reads every receipt and lists every file, so it runs only after
 * a failure and not after every change.
 */
export async function removeFiles(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
    return;
  } catch (error: unknown) {
    warnFiles('Photo files could not be deleted; they are swept as orphans now', error);
  }
  try {
    const rows = await getDb().selectFrom('organisation.beleg').select(['id', 'photo']).execute();
    await deleteOrphanedBelegPhotos(new Map(rows.map((row) => [row.id, row.photo])));
  } catch (error: unknown) {
    warnFiles('Orphaned photo files could not be swept; the next failed cleanup retries', error);
  }
}

function warnFiles(warning: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      scope: 'beleg-photos',
      warning,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}
