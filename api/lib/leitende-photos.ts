import { randomInt } from 'node:crypto';
import sharp from 'sharp';

/** Edge length of the stored photos of the Leitende; the upload sends a square of 600 px. */
export const PHOTO_SIZE = 300;
// The upload accepts at most 2 MB; a JPEG that size with more pixels is a decompression bomb
const MAX_INPUT_PIXELS = 8000 * 8000;

/**
 * A new file name per stored photo: the time, so a cached old photo is never served for a new
 * one, and a random part, so concurrent uploads and takeovers never write the same file and
 * each only ever deletes its own.
 */
export function newPhotoFileName(): string {
  return `foto-${Date.now()}${String(randomInt(1_000_000_000)).padStart(9, '0')}.jpg`;
}

/** The blob of a photo: `leitende/<id>/<foto-…jpg>`. */
export function photoBlobName(id: number | string, file: string): string {
  return `leitende/${id}/${file}`;
}

/**
 * Scales a photo into a JPEG of at most `PHOTO_SIZE` px per side. Encoding it anew also drops
 * the metadata of the original (camera, location); `rotate` applies its orientation first.
 */
export function toStoredPhoto(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}
