import { errorMessage, fetchApi } from './api';
import type { FotoFolderContent } from './types';

/** Links and previews of SharePoint expire after about an hour; reload well before. */
const MAX_AGE_MS = 30 * 60_000;

interface FolderEntry {
  data: FotoFolderContent | null;
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
}

/**
 * Folders of the photo library, kept while the page is open. The key is `/` plus the path, so
 * that a folder named like an object property (`constructor`, `__proto__`) is an entry too.
 */
export const fotoOrdner = $state<Record<string, FolderEntry>>({});

function key(path: string): string {
  return `/${path}`;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- running requests, never rendered
const pending = new Map<string, Promise<void>>();

export function folderEntry(path: string): FolderEntry {
  return fotoOrdner[key(path)] ?? { data: null, loading: true, error: null, loadedAt: null };
}

/** Whether the links of a loaded folder are still fresh enough to use. */
export function isFresh(path: string): boolean {
  const loadedAt = fotoOrdner[key(path)]?.loadedAt;
  return loadedAt != null && Date.now() - loadedAt < MAX_AGE_MS;
}

/** Loads a folder; without `force` a fresh copy is kept and a running request joined. */
export function loadFotoFolder(path: string, { force = false } = {}): Promise<void> {
  if (!force && isFresh(path)) return Promise.resolve();
  const running = pending.get(path);
  if (running) return running;

  fotoOrdner[key(path)] ??= { data: null, loading: true, error: null, loadedAt: null };
  // The proxy of the store, not the object assigned above
  const entry = fotoOrdner[key(path)];
  entry.loading = true;
  entry.error = null;
  const promise = (async () => {
    try {
      const data = await fetchApi<FotoFolderContent>(
        `/intern/fotos/ordner?pfad=${encodeURIComponent(path)}`
      );
      entry.data = data;
      entry.loadedAt = Date.now();
    } catch (error: unknown) {
      entry.error = errorMessage(
        error,
        'Der Ordner konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
      );
    } finally {
      entry.loading = false;
      pending.delete(path);
    }
  })();
  pending.set(path, promise);
  return promise;
}

/** Drops the cached copy of a folder and the folders above it, e.g. after an upload into it. */
export function forgetFotoFolder(path: string): void {
  const segments = path ? path.split('/') : [];
  for (let depth = 0; depth <= segments.length; depth++) {
    const entry = fotoOrdner[key(segments.slice(0, depth).join('/'))];
    if (entry) entry.loadedAt = null;
  }
}
