import { cleanName, fotoKind } from './fotoPfade';

// Which picked files are uploaded, and under which name.

/** Files offered for upload, with what was left out and why. */
export interface FotoSelection {
  files: File[];
  /** Not a photo or video, or empty. */
  rejected: string[];
  /** Picked more than once. */
  duplicates: number;
}

/**
 * Extensions for photos and videos whose name has none (e.g. shared from an app), by their type.
 * Only these are taken without extension, and all of them are accepted by the API.
 */
const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/tiff': 'tif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/dng': 'dng',
  'image/x-adobe-dng': 'dng',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/mpeg': 'mpg',
  'video/mp2t': 'mts',
  'video/x-ms-wmv': 'wmv',
};

/** Keeps photos and videos, each file once. */
export function selectFotoFiles(picked: Iterable<File>, already: File[] = []): FotoSelection {
  const key = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;
  const seen = new Set(already.map(key));
  const result: FotoSelection = { files: [], rejected: [], duplicates: 0 };
  for (const file of picked) {
    if (fotoKind(file.name) === 'file' && !MEDIA_TYPE_EXTENSIONS[file.type]) {
      result.rejected.push(file.name);
    } else if (file.size === 0) {
      result.rejected.push(file.name);
    } else if (seen.has(key(file))) {
      result.duplicates++;
    } else {
      seen.add(key(file));
      result.files.push(file);
    }
  }
  return result;
}

/** Name the file gets in SharePoint: cleaned, with an extension the API accepts. */
export function uploadName(file: File, index: number): string {
  let name = cleanName(file.name);
  if (fotoKind(name) === 'file') {
    // e.g. a photo without extension from an app; the type tells what it is
    const base = name || `Foto ${index + 1}`;
    name = cleanName(`${base}.${MEDIA_TYPE_EXTENSIONS[file.type] ?? 'jpg'}`);
  }
  return name || `Foto ${index + 1}.jpg`;
}
