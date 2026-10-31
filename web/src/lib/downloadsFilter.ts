import type { DownloadFile } from './types';

/** Topic of a file without an own one. */
export const DEFAULT_DOWNLOAD_CATEGORY = 'Allgemein';

/** The topics of the files, sorted, with the default topic last. */
export function downloadCategories(files: readonly Pick<DownloadFile, 'category'>[]): string[] {
  const names = [...new Set(files.map((file) => file.category || DEFAULT_DOWNLOAD_CATEGORY))];
  return names.sort((a, b) => {
    if (a === DEFAULT_DOWNLOAD_CATEGORY) return b === DEFAULT_DOWNLOAD_CATEGORY ? 0 : 1;
    if (b === DEFAULT_DOWNLOAD_CATEGORY) return -1;
    return a.localeCompare(b, 'de');
  });
}

/** Lower case without accents, so „anmeldung“ finds „Anmeldung“ and „uebersicht“ stays literal. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The files of one topic (`''`: all) whose name contains every word of the search, in the order
 * given.
 */
export function filterDownloads<T extends Pick<DownloadFile, 'fileName' | 'category'>>(
  files: readonly T[],
  search: string,
  category: string
): T[] {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  return files.filter((file) => {
    if (category && (file.category || DEFAULT_DOWNLOAD_CATEGORY) !== category) return false;
    const name = normalize(file.fileName);
    return words.every((word) => name.includes(word));
  });
}
