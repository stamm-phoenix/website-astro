import { deleteOrphanedBelegPhotos } from './beleg-photos';
import { getDb } from './db';

/** The full sweep of the photo folder runs at most this often per instance. */
export const ORPHAN_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

let lastSweep = 0;

/** Test seam: forgets the last sweep. */
export function resetOrphanSweep(): void {
  lastSweep = 0;
}

/**
 * Removes photo files no receipt refers to. It reads all receipts and lists the whole container,
 * so a change never triggers it directly: it runs at most once per `ORPHAN_SWEEP_INTERVAL_MS`
 * and instance (the first change after a start counts), which keeps the cleanup of a failed
 * deletion without making every change pay for it.
 */
async function sweepOrphans(now: number): Promise<void> {
  if (now - lastSweep < ORPHAN_SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    const rows = await getDb().selectFrom('organisation.beleg').select(['id', 'photo']).execute();
    await deleteOrphanedBelegPhotos(new Map(rows.map((row) => [row.id, row.photo])), now);
  } catch (error: unknown) {
    lastSweep = 0;
    throw error;
  }
}

/**
 * Deletes the files of the changed receipt (`work`) after the rows were changed. The change is
 * saved already, so a failure is only logged; the periodic sweep removes what was left.
 */
export async function removeFiles(
  work: () => Promise<unknown> = async () => undefined,
  now: number = Date.now()
): Promise<void> {
  for (const step of [work, () => sweepOrphans(now)]) {
    try {
      await step();
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          scope: 'beleg-photos',
          warning: 'Photo files could not be deleted; the next sweep removes them',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}
