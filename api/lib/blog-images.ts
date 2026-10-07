import sharp from 'sharp';
import type { HttpResponseInit } from '@azure/functions';
import { deleteBlobs, getBlob, putBlob } from './blob-storage';
import { getImageWidths } from './blog-list';
import type { BlogImage } from './pflege-validation';

/**
 * The files of blog images in Blob Storage: `blog/<post>/<file>/<width>.jpg`, one per width of
 * `getImageWidths`. They are computed once on upload, so serving them needs no scaling.
 */

const QUALITY = 82;
// The upload accepts at most 4 MB; a JPEG that size with more pixels is a decompression bomb
const MAX_INPUT_PIXELS = 8000 * 8000;

function postPrefix(postId: string): string {
  return `blog/${postId}/`;
}

function imagePrefix(postId: string, file: string): string {
  return `${postPrefix(postId)}${file}/`;
}

export function blogImageBlobName(postId: string, file: string, width: number): string {
  return `${imagePrefix(postId, file)}${width}.jpg`;
}

/**
 * Stores an uploaded JPEG in all widths. Every width is encoded anew, which also drops the
 * metadata of the original (camera, location).
 */
export async function storeBlogImageFiles(
  postId: string,
  image: BlogImage,
  bytes: Uint8Array
): Promise<void> {
  for (const width of getImageWidths(image.width)) {
    const scaled = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();
    await putBlob(blogImageBlobName(postId, image.file, width), scaled, 'image/jpeg');
  }
}

/** The stored file of an image in one width as a response, or undefined if it is missing. */
export async function serveBlogImage(
  postId: string,
  file: string,
  width: number
): Promise<HttpResponseInit | undefined> {
  const bytes = await getBlob(blogImageBlobName(postId, file, width));
  if (!bytes) return undefined;
  return {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length) },
    body: new Uint8Array(bytes),
  };
}

export async function deleteBlogImageFiles(postId: string, file: string): Promise<void> {
  await deleteBlobs(imagePrefix(postId, file));
}

export async function deleteBlogPostFiles(postId: string): Promise<void> {
  await deleteBlobs(postPrefix(postId));
}
