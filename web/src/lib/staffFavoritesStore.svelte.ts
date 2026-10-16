import { errorMessage, fetchApi, sendApi } from './api';

/**
 * Favorites of the start page of the Leitendenbereich, saved per account on the server
 * (`/api/intern/favoriten`), so they apply on every device.
 */

const ENDPOINT = '/intern/favoriten';
const SAVE_FAILED =
  'Deine Favoriten wurden nicht gespeichert. Prüfe deine Internetverbindung und tippe auf „Erneut speichern“.';
const LOAD_FAILED =
  'Deine Favoriten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut laden“.';

interface FavoritesState {
  /** Module paths as shown, including changes that are not saved yet. */
  modules: string[];
  /** The selection the server has; differs from `modules` while a save is due or failed. */
  saved: string[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  notice: { text: string; kind: 'success' | 'error' } | null;
}

export const favoritesStore = $state<FavoritesState>({
  modules: [],
  saved: [],
  loaded: false,
  loading: false,
  loadError: null,
  notice: null,
});

/** The paths of `known` that are in `paths`, in the order of `known`. */
function knownPaths(paths: unknown, known: string[]): string[] {
  return Array.isArray(paths) ? known.filter((path) => paths.includes(path)) : [];
}

/** Favorites a browser kept before they moved to the server; removed once taken over. */
function legacyKey(userId: string): string {
  return `phoenix:staff-favorites:v1:${userId}`;
}

function readLegacyFavorites(userId: string, known: string[]): string[] {
  try {
    return knownPaths(JSON.parse(localStorage.getItem(legacyKey(userId)) ?? '[]'), known);
  } catch {
    return [];
  }
}

function removeLegacyFavorites(userId: string): void {
  try {
    localStorage.removeItem(legacyKey(userId));
  } catch {
    // Blocked storage holds nothing to remove
  }
}

/** Saves run one after another, so an older selection never overwrites a newer one. */
let queue: Promise<void> = Promise.resolve();

/**
 * Loads the favorites of the account, keeping only the `known` module paths. An account without
 * saved favorites takes over the selection of this browser once.
 */
export async function loadFavorites(userId: string, known: string[]): Promise<void> {
  // No choosing while loading, so a late answer cannot replace a newer choice
  favoritesStore.loaded = false;
  favoritesStore.loading = true;
  favoritesStore.loadError = null;
  try {
    // Saves still running (e.g. from before leaving the page) finish first, so the answer has them
    await queue;
    let { modules } = await fetchApi<{ modules: string[] | null }>(ENDPOINT);
    if (modules === null) {
      const legacy = readLegacyFavorites(userId, known);
      // The server keeps favorites saved meanwhile on another device and answers with them
      modules = legacy.length
        ? (
            await sendApi<{ modules: string[] }>('PUT', ENDPOINT, {
              modules: legacy,
              takeover: true,
            })
          ).modules
        : [];
    }
    favoritesStore.modules = knownPaths(modules, known);
    favoritesStore.saved = favoritesStore.modules;
    favoritesStore.loaded = true;
    removeLegacyFavorites(userId);
  } catch (error: unknown) {
    favoritesStore.loadError = errorMessage(error, LOAD_FAILED);
  } finally {
    favoritesStore.loading = false;
  }
}

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((path) => b.includes(path));
}

/** Whether the shown selection differs from the saved one. */
export function favoritesUnsaved(): boolean {
  return !sameSelection(favoritesStore.modules, favoritesStore.saved);
}

/** Saves the shown selection after all earlier saves. */
export function saveFavorites(): void {
  queue = queue.then(async () => {
    const selection = [...favoritesStore.modules];
    try {
      await sendApi('PUT', ENDPOINT, { modules: selection });
      favoritesStore.saved = selection;
      // Every save sends the whole selection, so it also covers an earlier failed one
      favoritesStore.notice = { text: 'Favoriten gespeichert.', kind: 'success' };
    } catch (error: unknown) {
      // The selection stays on screen, so it can be saved again without choosing anew
      favoritesStore.notice = { text: errorMessage(error, SAVE_FAILED), kind: 'error' };
    }
  });
}

/** Adds or removes a favorite and saves it right away. */
export function toggleFavorite(path: string): void {
  favoritesStore.modules = favoritesStore.modules.includes(path)
    ? favoritesStore.modules.filter((module) => module !== path)
    : [...favoritesStore.modules, path];
  saveFavorites();
}
