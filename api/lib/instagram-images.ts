import sharp from 'sharp';
import { readLimited } from './response-utils';

/**
 * Downscaled copies of Instagram images. The tiles are at most ~360 CSS pixels wide, so 640px
 * covers high-density screens while being a fraction of the original size; the post dialog
 * shows images larger and gets 1440px (about the original size).
 */

export interface ScaledImage {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export type ImageSize = 'small' | 'large';

const MAX_SIZES: Record<ImageSize, number> = { small: 640, large: 1440 };
// Tiles are small previews, so they get a stronger compression than the dialog images
const QUALITY: Record<ImageSize, number> = { small: 55, large: 75 };
const WEBP_EFFORT = 6;
const TIMEOUT_MS = 15_000;
// Instagram images are at most 1440 × 1800 pixels and a few MB; anything far beyond is refused
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4096 * 4096;
// ~50 KB (small) to ~200 KB (large) per image, so the cache stays at a few dozen MB at most
const CACHE_MAX_ENTRIES = 300;
const CACHE_TTL_MS = 24 * 60 * 60_000;

const cache = new Map<string, { image: ScaledImage; expires: number }>();
const pending = new Map<string, Promise<ScaledImage | undefined>>();

/**
 * Returns the image at `url` scaled down to the given size as WebP, cached under `key`.
 * @returns undefined if Instagram could not deliver the image.
 */
export function getScaledImage(
  imageKey: string,
  url: string,
  size: ImageSize = 'small'
): Promise<ScaledImage | undefined> {
  const key = `${imageKey}/${size}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.image);
  }

  let request = pending.get(key);
  if (!request) {
    request = loadScaledImage(url, size)
      .then((image) => {
        if (image) {
          if (cache.size >= CACHE_MAX_ENTRIES) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(key, { image, expires: Date.now() + CACHE_TTL_MS });
        }
        return image;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
  }
  return request;
}

async function loadScaledImage(url: string, size: ImageSize): Promise<ScaledImage | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    return undefined;
  }
  const original = await readLimited(response, MAX_INPUT_BYTES);
  const body = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(MAX_SIZES[size], MAX_SIZES[size], { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY[size], effort: WEBP_EFFORT, smartSubsample: true })
    .toBuffer();
  return { body: new Uint8Array(body), contentType: 'image/webp' };
}
