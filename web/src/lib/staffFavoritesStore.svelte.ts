import { errorMessage, fetchApi, sendApi } from './api';
import { STAFF_FAVORITE_PATHS } from './staffModules';

/**
 * Favorites of the start page of the Leitendenbereich, saved per account on the server
 * (`/api/intern/favoriten`), so they apply on every device.
 */

const ENDPOINT = '/intern/favoriten';
const SAVE_FAILED =
  'Deine Favoriten wurden nicht gespeichert. Prüfe deine Internetverbindung und tippe auf „Erneut speichern“.';
const LOAD_FAILED =
  'Deine Favoriten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.';

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

/** The selection this browser kept, also an empty one; `null` if it kept none. */
function readLegacyFavorites(userId: string, known: string[]): string[] | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(legacyKey(userId)) ?? 'null');
    return Array.isArray(stored) ? knownPaths(stored, known) : null;
  } catch {
    return null;
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
      // An empty selection is taken over too, so another browser cannot bring back old ones.
      // The server keeps favorites saved meanwhile on another device and answers with them.
      modules = legacy
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
    // The shown selection is the saved one again, so an earlier save result no longer applies
    favoritesStore.notice = null;
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

/** Saves sent or waiting; until they are done, the server may still hold an older choice. */
let pendingSaves = 0;

/**
 * Whether the shown selection is not confirmed as saved yet: it differs from the saved one, or
 * a save is still running (a tick taken back meanwhile may still be on the server).
 */
export function favoritesUnsaved(): boolean {
  return pendingSaves > 0 || !sameSelection(favoritesStore.modules, favoritesStore.saved);
}

/**
 * Saves the shown selection after all earlier saves. `success` is the confirmation, e.g. naming
 * the area that changed; a retry confirms all favorites.
 */
export function saveFavorites(success = 'Favoriten gespeichert.'): void {
  pendingSaves++;
  queue = queue.then(async () => {
    const selection = [...favoritesStore.modules];
    try {
      await sendApi('PUT', ENDPOINT, { modules: selection });
      favoritesStore.saved = selection;
      pendingSaves--;
      // Every save sends the whole selection, so it also covers an earlier failed one. A newer
      // choice is confirmed by its own save.
      if (!favoritesUnsaved()) {
        favoritesStore.notice = { text: success, kind: 'success' };
      }
    } catch (error: unknown) {
      pendingSaves--;
      // The selection stays on screen, so it can be saved again without choosing anew
      favoritesStore.notice = { text: errorMessage(error, SAVE_FAILED), kind: 'error' };
    }
  });
}

/** Adds or removes a favorite and saves it right away; `title` names it in the confirmation. */
export function toggleFavorite(path: string, title?: string): void {
  const adding = !favoritesStore.modules.includes(path);
  favoritesStore.modules = adding
    ? [...favoritesStore.modules, path]
    : favoritesStore.modules.filter((module) => module !== path);
  // An earlier result does not apply to the new choice
  favoritesStore.notice = null;
  saveFavorites(
    title
      ? adding
        ? `„${title}“ ist jetzt ein Favorit.`
        : `„${title}“ ist kein Favorit mehr.`
      : undefined
  );
}

/**
 * The action of a long press on an area: toggling it as a favorite, once the favorites are
 * loaded and if it can be one (the Nikolaus modules cannot, they are only there in winter).
 */
export function favoriteToggle(module: { href: string; title: string }): (() => void) | undefined {
  if (!favoritesStore.loaded || !STAFF_FAVORITE_PATHS.includes(module.href)) return undefined;
  return () => toggleFavorite(module.href, module.title);
}
