import { emptyState } from './resource.svelte';
import type { ResourceState } from './resource.svelte';
import { createResourceMap } from './resourceMap.svelte';
import type { FotoFolderContent } from '../../../api/lib/fotos-model';

/** Links and previews of SharePoint expire after about an hour; reload well before. */
const MAX_AGE_MS = 30 * 60_000;

const folders = createResourceMap<FotoFolderContent, string>(
  (path) => `/intern/fotos/ordner?pfad=${encodeURIComponent(path)}`,
  {
    // `/` plus the path, so that a folder named like an object property (`constructor`,
    // `__proto__`) is an entry too
    keyOf: (path) => `/${path}`,
    loadError:
      'Der Ordner konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

/** Folders of the photo library, kept while the page is open, under `/` plus the path. */
export const fotoOrdner = folders.state;

export function folderEntry(path: string): ResourceState<FotoFolderContent> {
  return fotoOrdner[`/${path}`] ?? emptyState<FotoFolderContent>(true);
}

/** Whether the links of a loaded folder are still fresh enough to use. */
export function isFresh(path: string): boolean {
  return folders.isCurrent(path, MAX_AGE_MS);
}

/** Loads a folder; without `force` a fresh copy is kept and a running request joined. */
export function loadFotoFolder(path: string, { force = false } = {}): Promise<void> {
  return folders.load(path, { force, maxAge: MAX_AGE_MS });
}

/**
 * Drops the cached copy of a folder and the folders above it, e.g. after an upload into it. A
 * folder that is loading right now asked before the change, so it is asked again.
 */
export function forgetFotoFolder(path: string): void {
  const segments = path ? path.split('/') : [];
  for (let depth = 0; depth <= segments.length; depth++) {
    const folder = segments.slice(0, depth).join('/');
    folders.invalidate(folder);
    if (fotoOrdner[`/${folder}`]?.loading) void loadFotoFolder(folder);
  }
}
