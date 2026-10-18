import { fetchApi, sendApi } from './api';

/**
 * The areas of the Leitendenbereich the logged-in person opened last, the latest first, saved on
 * the server (`/api/intern/zuletzt`), so they are the same on every device. Only a convenience:
 * a failed load or save is not reported and the places fall back to the favorites.
 */

const ENDPOINT = '/intern/zuletzt';

interface RecentState {
  modules: string[];
  /** Whether the list came from the server; until then the places wait or use defaults. */
  loaded: boolean;
}

export const recentStore = $state<RecentState>({ modules: [], loaded: false });

let loading: Promise<void> | null = null;

/** Loads the list once; Astro navigation keeps it, and every recorded visit brings it fresh. */
export function loadRecent(): Promise<void> {
  if (recentStore.loaded) return Promise.resolve();
  loading ??= fetchApi<{ modules: string[] }>(ENDPOINT)
    .then(({ modules }) => {
      recentStore.modules = modules;
    })
    .catch(() => undefined)
    .finally(() => {
      recentStore.loaded = true;
      loading = null;
    });
  return loading;
}

/** Records that the person opened `module`; the answer is the new list. */
export async function recordVisit(module: string): Promise<void> {
  // Shown at once, so the bar on the phone does not wait for the server
  recentStore.modules = [module, ...recentStore.modules.filter((entry) => entry !== module)];
  try {
    const { modules } = await sendApi<{ modules: string[] }>('POST', ENDPOINT, { module });
    recentStore.modules = modules;
  } catch {
    // Not saved this time; the next opening of a module tries again
  } finally {
    recentStore.loaded = true;
  }
}
