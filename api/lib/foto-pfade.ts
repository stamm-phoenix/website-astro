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

/** The first `length` UTF-16 units, without cutting an emoji or other pair in half. */
function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  const code = text.charCodeAt(length - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
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
    cleaned = `${truncate(cleaned, MAX_NAME_LENGTH - keep).trimEnd()}${keep ? `.${ext}` : ''}`;
    // Shortening may leave a dot or space at the end, which SharePoint refuses
    cleaned = cleaned.replace(/[\s.]+$/, '');
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
 * Whether a name of an existing folder or file can be part of a path: SharePoint stores names
 * the cleaning would change (double spaces, long names), so only what could leave the folder
 * or break the path is refused.
 */
function isStoredName(name: string): boolean {
  return (
    name.trim() !== '' &&
    name !== '.' &&
    name !== '..' &&
    name.length <= MAX_PATH_LENGTH &&
    !new RegExp(INVALID_CHARACTERS.source).test(name) // without the global flag's state
  );
}

/**
 * The segments of a folder path inside the library (`2026/Sommerlager/Nico`), or null if a
 * segment could not be a folder name. The empty path is the top folder of the library.
 */
export function splitFotoPath(path: string): string[] | null {
  if (path === '') return [];
  if (path.length > MAX_PATH_LENGTH) return null;
  const segments = path.split('/');
  return segments.every(isStoredName) ? segments : null;
}

/**
 * `IMG.jpg` → `IMG (2).jpg`: another name for a file whose name is taken. A long name is
 * shortened in front of the number, so the result stays a clean name.
 */
export function numberedName(name: string, number: number): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const suffix = ` (${number})`;
  const base = truncate(
    dot > 0 ? name.slice(0, dot) : name,
    MAX_NAME_LENGTH - suffix.length - ext.length
  ).trimEnd();
  return `${base}${suffix}${ext}`;
}

/** Names an upload tries in this order, `IMG.jpg` to `IMG (49).jpg`. */
export function fotoNameCandidates(name: string): string[] {
  return [name, ...Array.from({ length: 49 }, (_, index) => numberedName(name, index + 1))];
}

/** Top folder of the photos of Aktionen; next to it are e.g. the Gruppenstunden. */
export const FOTO_AKTIONEN_FOLDER = 'Aktionen';

/**
 * Folder for the photos of an Aktion: `Aktionen/<Jahr>/<Aktion>/<Vorname>`, e.g.
 * `Aktionen/2026/Sommerlager Westernohe/Nico`. Null if the year is invalid or a name has nothing
 * usable.
 */
export function aktionFotoPath(year: string, aktion: string, person: string): string | null {
  if (!/^\d{4}$/.test(year)) return null;
  const segments = [FOTO_AKTIONEN_FOLDER, year, cleanName(aktion), cleanName(person)];
  return segments.every(Boolean) ? segments.join('/') : null;
}

/**
 * Page of the module „Fotos“ with a folder open, e.g. `/leitendenbereich/fotos#pfad=Aktionen%2F2026`;
 * the same hash as the page sets itself (`web/src/lib/fotoAnsicht.ts`).
 */
export function fotoOrdnerLink(path: string): string {
  return `/leitendenbereich/fotos#${new URLSearchParams({ pfad: path }).toString()}`;
}

/** „12 neue Fotos und 2 neue Videos“, „1 neues Foto“, „3 neue Dateien“. */
export function fotoAnzahlText(files: { name: string }[]): string {
  const photos = files.filter((file) => fotoKind(file.name) === 'photo').length;
  const videos = files.filter((file) => fotoKind(file.name) === 'video').length;
  const others = files.length - photos - videos;
  const part = (count: number, one: string, many: string): string =>
    count === 0 ? '' : count === 1 ? `1 ${one}` : `${count} ${many}`;
  const parts = [
    part(photos, 'neues Foto', 'neue Fotos'),
    part(videos, 'neues Video', 'neue Videos'),
    part(others, 'neue Datei', 'neue Dateien'),
  ].filter(Boolean);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`
    : (parts[0] ?? '0 neue Fotos');
}
