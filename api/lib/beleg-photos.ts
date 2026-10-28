import { randomInt } from 'node:crypto';
import { deleteBlob, getBlob, listBlobs, putBlob } from './blob-storage';

/**
 * The photos of the Belege in Blob Storage, `belege/<id>/<datei>`: the photo for the archive
 * (`beleg-<digits>.jpg`, or for a scan `beleg-<digits>-scan.jpg` with the unedited photo
 * `beleg-<digits>-original.jpg` next to it, or a PDF `beleg-<digits>.pdf` with its first page
 * `beleg-<digits>-seite.jpg`, drawn by the browser) and its preview `beleg-<digits>-thumb.jpg`,
 * made on the first request. Only the photo's name is stored with the receipt
 * (`organisation.beleg`).
 */

/** Longest edge of the preview in the list. */
const THUMB_EDGE = 480;
// The upload accepts at most 4 MB; a JPEG that size with more pixels is a decompression bomb
const MAX_INPUT_PIXELS = 8000 * 8000;

/** A photo as taken, a scan of it, or a PDF. */
export type BelegPhotoKind = 'foto' | 'scan' | 'pdf';

/**
 * A new name per stored photo: the time, so a cached old photo is never served for a new one,
 * and a random part, so concurrent uploads never write the same files.
 */
export function newBelegPhotoName(kind: BelegPhotoKind): string {
  const base = `beleg-${Date.now()}${String(randomInt(1_000_000_000)).padStart(9, '0')}`;
  if (kind === 'pdf') return `${base}.pdf`;
  return kind === 'scan' ? `${base}-scan.jpg` : `${base}.jpg`;
}

function base(photo: string): string {
  return photo.replace(/(-scan)?\.(jpg|pdf)$/, '');
}

/** Whether the receipt is stored as a PDF. */
export function isPdfFileName(photo: string | null | undefined): boolean {
  return !!photo && /\.pdf$/.test(photo);
}

/** The unedited photo next to a scan; photos without a scan have none. */
export function originalFileName(photo: string | null | undefined): string | undefined {
  return photo && /-scan\.jpg$/.test(photo) ? `${base(photo)}-original.jpg` : undefined;
}

/** The first page of a PDF as a picture, shown instead of the PDF; photos have none. */
export function pageFileName(photo: string | null | undefined): string | undefined {
  return photo && isPdfFileName(photo) ? `${base(photo)}-seite.jpg` : undefined;
}

export function thumbFileName(photo: string): string {
  return `${base(photo)}-thumb.jpg`;
}

export function belegBlobName(id: number | string, file: string): string {
  return `belege/${id}/${file}`;
}

/** All files of a photo: the photo, its original or first page, and its preview. */
export function belegPhotoFiles(photo: string): string[] {
  return [photo, originalFileName(photo), pageFileName(photo), thumbFileName(photo)].filter(
    (file): file is string => file !== undefined
  );
}

/**
 * Stores a photo and, for a scan, its original under a new name; returns the name. Both are
 * JPEGs (the endpoint checks them). With `pdf`, the PDF is the receipt and `photo` its first
 * page. If writing fails, the files already written are deleted.
 */
export async function storeBelegPhoto(
  id: number,
  photo: Uint8Array,
  original?: Uint8Array,
  pdf?: Uint8Array
): Promise<string> {
  const name = newBelegPhotoName(pdf ? 'pdf' : original ? 'scan' : 'foto');
  const written: string[] = [];
  try {
    const originalName = originalFileName(name);
    if (original && originalName) {
      written.push(originalName);
      await putBlob(belegBlobName(id, originalName), original, 'image/jpeg');
    }
    const pageName = pageFileName(name);
    if (pdf && pageName) {
      written.push(pageName);
      await putBlob(belegBlobName(id, pageName), photo, 'image/jpeg');
      written.push(name);
      await putBlob(belegBlobName(id, name), pdf, 'application/pdf');
      return name;
    }
    written.push(name);
    await putBlob(belegBlobName(id, name), photo, 'image/jpeg');
    return name;
  } catch (error: unknown) {
    await Promise.allSettled(written.map((file) => deleteBlob(belegBlobName(id, file))));
    throw error;
  }
}

/** Deletes all files of a photo. */
export async function deleteBelegPhoto(id: number, photo: string): Promise<void> {
  for (const file of belegPhotoFiles(photo)) await deleteBlob(belegBlobName(id, file));
}

/**
 * The picture of the receipt (for a PDF its first page), its original, its preview (made and
 * stored on the first request) or the stored file itself (`file`: the PDF or the photo).
 */
export async function readBelegPhoto(
  id: number,
  photo: string,
  variant: 'photo' | 'original' | 'thumb' | 'file'
): Promise<Buffer | undefined> {
  if (variant === 'original') {
    const original = originalFileName(photo);
    return original ? getBlob(belegBlobName(id, original)) : undefined;
  }
  if (variant === 'file') return getBlob(belegBlobName(id, photo));
  const picture = pageFileName(photo) ?? photo;
  if (variant === 'photo') return getBlob(belegBlobName(id, picture));
  const thumbName = belegBlobName(id, thumbFileName(photo));
  const stored = await getBlob(thumbName);
  if (stored) return stored;
  const full = await getBlob(belegBlobName(id, picture));
  if (!full) return undefined;
  let thumb: Buffer;
  const { default: sharp } = await import('sharp');
  try {
    thumb = await sharp(full, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    // A photo sharp cannot decode is still a JPEG the browser may show
    return full;
  }
  await putBlob(thumbName, thumb, 'image/jpeg');
  return thumb;
}

/** Files younger than this may belong to a photo being saved right now. */
export const ORPHAN_MIN_AGE_MS = 10 * 60_000;

/**
 * Deletes photo files no receipt refers to any more, e.g. after a deletion whose cleanup failed.
 * Only files older than `ORPHAN_MIN_AGE_MS`: uploads store a file before they save its name. IDs are never reused, so a file of a deleted receipt never becomes current.
 */
export async function deleteOrphanedBelegPhotos(
  current: ReadonlyMap<number, string | null>,
  now: number = Date.now()
): Promise<number> {
  const files = await listBlobs('belege/');
  let deleted = 0;
  for (const file of files) {
    const match = /^belege\/(\d+)\/(.+)$/.exec(file.name);
    const photo = match ? current.get(Number(match[1])) : undefined;
    if (photo && belegPhotoFiles(photo).includes(match?.[2] ?? '')) continue;
    if (now - file.lastModified.getTime() < ORPHAN_MIN_AGE_MS) continue;
    await deleteBlob(file.name);
    deleted++;
  }
  return deleted;
}
