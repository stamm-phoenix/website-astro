import { CHANGELOG } from './changelogEntries';
import { newestEntryId, unseenEntries } from './changelog';
import { fetchApi, sendApi } from './api';

/**
 * Which entries of the changelog the logged-in person has seen, saved on the server
 * (`/api/intern/neuigkeiten`), so it is the same on every device. Only a convenience: a failed
 * load shows no bubble, and a failed save leaves the entries new until the next visit.
 */

const ENDPOINT = '/intern/neuigkeiten';

interface ChangelogState {
  /** ID of the newest entry the server knows as seen; `null` before the first visit. */
  lastSeenId: string | null;
  /** Whether `lastSeenId` came from the server; until then no bubble is shown. */
  loaded: boolean;
  /** The last save failed, so the entries still count as new. */
  saveFailed: boolean;
}

export const changelogStore = $state<ChangelogState>({
  lastSeenId: null,
  loaded: false,
  saveFailed: false,
});

let loading: Promise<void> | null = null;

/** Loads the seen state once; Astro navigation keeps it. */
export function loadChangelogSeen(): Promise<void> {
  if (changelogStore.loaded) return Promise.resolve();
  loading ??= fetchApi<{ lastSeenId: string | null }>(ENDPOINT)
    .then(({ lastSeenId }) => {
      changelogStore.lastSeenId = lastSeenId;
      changelogStore.loaded = true;
    })
    .catch(() => {
      // No bubble this time; the next page tries again
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** How many entries are new to the person; 0 until the state has loaded. */
export function unseenCount(): number {
  return changelogStore.loaded ? unseenEntries(CHANGELOG, changelogStore.lastSeenId).length : 0;
}

/** Marks every entry as seen. Resolves to whether the server saved it. */
export async function markChangelogSeen(): Promise<boolean> {
  const newest = newestEntryId(CHANGELOG);
  if (newest === null) return true;
  try {
    const { lastSeenId } = await sendApi<{ lastSeenId: string }>('PUT', ENDPOINT, {
      lastSeenId: newest,
    });
    changelogStore.lastSeenId = lastSeenId;
    changelogStore.loaded = true;
    changelogStore.saveFailed = false;
    return true;
  } catch {
    changelogStore.saveFailed = true;
    return false;
  }
}
