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

/**
 * Requests run one after another, so the server records the visits in the order they happened,
 * and an answer applies only while nothing newer was started: a late answer for an earlier
 * visit or load cannot replace the list of a later one.
 */
let queue: Promise<void> = Promise.resolve();
let generation = 0;

function enqueue(request: () => Promise<{ modules: string[] }>): Promise<void> {
  const mine = ++generation;
  const run = queue.then(async () => {
    try {
      const { modules } = await request();
      if (generation === mine) recentStore.modules = modules;
    } catch {
      // Not saved or loaded this time; the next opening of a module tries again
    } finally {
      if (generation === mine) recentStore.loaded = true;
    }
  });
  queue = run;
  return run;
}

/** Loads the list once; Astro navigation keeps it, and every recorded visit brings it fresh. */
export function loadRecent(): Promise<void> {
  if (recentStore.loaded || generation > 0) return queue;
  return enqueue(() => fetchApi<{ modules: string[] }>(ENDPOINT));
}

/** Records that the person opened `module`; the answer is the new list. */
export function recordVisit(module: string): Promise<void> {
  // Shown at once, so the bar on the phone does not wait for the server
  recentStore.modules = [module, ...recentStore.modules.filter((entry) => entry !== module)];
  return enqueue(() => sendApi<{ modules: string[] }>('POST', ENDPOINT, { module }));
}
