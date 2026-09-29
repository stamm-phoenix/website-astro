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
// Instagram images are at most 1440 × 1800 pixels and a few MB; anything far beyond is refused
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4096 * 4096;
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
  const original = await readLimited(response, MAX_INPUT_BYTES);
  const body = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
  return { body: new Uint8Array(body), contentType: 'image/webp' };
}

/**
 * Reads the response body, but no more than `limit` bytes. Content-Length only allows an early
 * rejection, as it may be missing or wrong.
 */
async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > limit) {
    throw new Error(`Instagram image is too large (${declared} bytes)`);
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`Instagram image is too large (more than ${limit} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
