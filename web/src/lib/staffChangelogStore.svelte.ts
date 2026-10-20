import { CHANGELOG } from './changelogEntries';
import { newestEntryId, unseenEntries } from './changelog';
import { errorMessage, fetchApi, sendApi } from './api';

/**
 * Which entries of the changelog the logged-in person has seen, saved on the server
 * (`/api/intern/neuigkeiten`), so it is the same on every device. The bubble is only a
 * convenience: a failed load shows no bubble. The page „Neuigkeiten“ reports failures itself.
 */

const ENDPOINT = '/intern/neuigkeiten';
const LOAD_FAILED =
  'Dein Lesestand konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es noch einmal.';
const SAVE_FAILED =
  'Die Neuigkeiten wurden nicht als gelesen gespeichert. Prüfe deine Internetverbindung und lade die Seite neu.';

interface ChangelogState {
  /** ID of the newest entry the server knows as seen; `null` before the first visit. */
  lastSeenId: string | null;
  /** Whether `lastSeenId` came from the server; until then no bubble is shown. */
  loaded: boolean;
  /** Why the last load failed; `null` after a success. */
  loadError: string | null;
  /** Why the last save failed; `null` after a save succeeded. A later load does not clear it. */
  saveError: string | null;
}

export const changelogStore = $state<ChangelogState>({
  lastSeenId: null,
  loaded: false,
  loadError: null,
  saveError: null,
});

let loading: Promise<boolean> | null = null;
/** Counts saves, so a load that started before a save cannot bring back the older state. */
let saves = 0;

/**
 * Loads the seen state from the server. Astro keeps the store across pages, so every page asks
 * again: reading on another device shows here at the next page. Calls that overlap share one
 * request. Resolves to whether the state is fresh.
 */
export function loadChangelogSeen(): Promise<boolean> {
  loading ??= (async () => {
    const before = saves;
    try {
      const { lastSeenId } = await fetchApi<{ lastSeenId: string | null }>(ENDPOINT);
      if (saves === before) {
        changelogStore.lastSeenId = lastSeenId;
        changelogStore.loaded = true;
      }
      changelogStore.loadError = null;
      return true;
    } catch (error) {
      changelogStore.loadError = errorMessage(error, LOAD_FAILED);
      return false;
    } finally {
      loading = null;
    }
  })();
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
  saves++;
  try {
    const { lastSeenId } = await sendApi<{ lastSeenId: string }>('PUT', ENDPOINT, {
      lastSeenId: newest,
    });
    changelogStore.lastSeenId = lastSeenId;
    changelogStore.loaded = true;
    changelogStore.saveError = null;
    return true;
  } catch (error) {
    changelogStore.saveError = errorMessage(error, SAVE_FAILED);
    return false;
  }
}
