// Rules for names and paths in the photo library, shared by the API and the frontend
// (`web/src/lib/fotoPfade.ts`). Keep this file free of imports and Node/browser-specific APIs.

/** Characters SharePoint does not allow in file and folder names, and control characters. */
// eslint-disable-next-line no-control-regex
const INVALID_CHARACTERS = /["*:<>?/\\|\u0000-\u001f\u007f]/g;

/** Names SharePoint reserves or Windows cannot open. */
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com\d|lpt\d|desktop\.ini|forms)$/i;

const MAX_NAME_LENGTH = 120;
const MAX_PATH_LENGTH = 380;

/** Photo formats of phones (JPEG, HEIC) and cameras (RAW formats of the common makers). */
const PHOTO_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'avif',
  'tif',
  'tiff',
  'bmp',
  'dng',
  'cr2',
  'cr3',
  'crw',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'orf',
  'rw2',
  'raf',
  'pef',
  'srw',
  'x3f',
  '3fr',
  'erf',
  'kdc',
  'mrw',
  'mos',
  'raw',
  'rwl',
  'iiq',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'qt',
  '3gp',
  '3g2',
  'avi',
  'mkv',
  'webm',
  'mts',
  'm2ts',
  'mpg',
  'mpeg',
  'wmv',
  'hevc',
]);

/** Extensions offered by the file picker, e.g. `.heic,.cr2,…`, next to `image/*,video/*`. */
export const MEDIA_ACCEPT = [
  'image/*',
  'video/*',
  ...[...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS].map((extension) => `.${extension}`),
].join(',');

/** Photo, video or another file (e.g. a PDF someone put into the library). */
export type FotoKind = 'photo' | 'video' | 'file';

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Kind of a file by its extension. */
export function fotoKind(name: string): FotoKind {
  const ext = extension(name);
  if (PHOTO_EXTENSIONS.has(ext)) return 'photo';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'file';
}

/**
 * A folder or file name SharePoint accepts: invalid characters become spaces, runs of spaces
 * one, leading and trailing dots and spaces are removed. Empty if nothing usable is left.
 */
export function cleanName(name: string): string {
  let cleaned = name
    .normalize('NFC')
    .replace(INVALID_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.~]+|[\s.]+$/g, '');
  if (cleaned.length > MAX_NAME_LENGTH) {
    // Keep the extension of long file names
    const ext = extension(cleaned);
    const keep = ext && ext.length <= 8 ? ext.length + 1 : 0;
    cleaned = `${cleaned.slice(0, MAX_NAME_LENGTH - keep).trimEnd()}${keep ? `.${ext}` : ''}`;
  }
  if (!cleaned || RESERVED_NAMES.test(cleaned) || cleaned.toLowerCase().includes('_vti_')) {
    return '';
  }
  return cleaned;
}

/** Whether a name can be used as it is, without cleaning. */
export function isCleanName(name: string): boolean {
  return name !== '' && cleanName(name) === name;
}

/**
 * The segments of a folder path inside the library (`2026/Sommerlager/Nico`), or null if a
 * segment is not a clean name. The empty path is the top folder of the library.
 */
export function splitFotoPath(path: string): string[] | null {
  if (path === '') return [];
  if (path.length > MAX_PATH_LENGTH) return null;
  const segments = path.split('/');
  return segments.every(isCleanName) ? segments : null;
}

/**
 * Folder for the photos of an Aktion: `<Jahr>/<Aktion>/<Vorname>`, e.g.
 * `2026/Sommerlager Westernohe/Nico`. Null if the year is invalid or a name has nothing usable.
 */
export function aktionFotoPath(year: string, aktion: string, person: string): string | null {
  if (!/^\d{4}$/.test(year)) return null;
  const segments = [year, cleanName(aktion), cleanName(person)];
  return segments.every(Boolean) ? segments.join('/') : null;
}
