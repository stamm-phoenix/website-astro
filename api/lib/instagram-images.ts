import sharp from 'sharp';

/**
 * Downscaled copies of Instagram images. The tiles are at most ~360 CSS pixels wide, so 720px
 * covers high-density screens while being a fraction of the original size.
 */

export interface ScaledImage {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const MAX_SIZE = 720;
const QUALITY = 75;
const TIMEOUT_MS = 15_000;
// ~50 KB per image, so the cache stays at a few MB
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 24 * 60 * 60_000;

const cache = new Map<string, { image: ScaledImage; expires: number }>();
const pending = new Map<string, Promise<ScaledImage | undefined>>();

/**
 * Returns the image at `url` scaled down to MAX_SIZE as WebP, cached under `key`.
 * @returns undefined if Instagram could not deliver the image.
 */
export function getScaledImage(key: string, url: string): Promise<ScaledImage | undefined> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.image);
  }

  let request = pending.get(key);
  if (!request) {
    request = loadScaledImage(url)
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

async function loadScaledImage(url: string): Promise<ScaledImage | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    return undefined;
  }
  const original = Buffer.from(await response.arrayBuffer());
  const body = await sharp(original)
    .rotate()
    .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
  return { body: new Uint8Array(body), contentType: 'image/webp' };
}
