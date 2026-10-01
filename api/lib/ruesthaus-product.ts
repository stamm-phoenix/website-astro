import { ValidationError } from './pflege-validation';
import type { SammelProductInfo } from './sammelbestellung-model';

interface CachedProduct {
  expiresAt: number;
  product: SammelProductInfo;
}

const cache = new Map<string, CachedProduct>();
const pending = new Map<string, Promise<SammelProductInfo>>();
const MAX_HTML_BYTES = 2_000_000;

/** Restricts shop URLs and redirect destinations to HTTPS on the exact Ruesthaus hosts. */
function shopUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['ruesthaus.de', 'www.ruesthaus.de'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Unsupported shop URL');
  url.hash = '';
  return url;
}

/** Requires a bounded Ruesthaus product URL with a numeric product path. */
export function ruesthausProductUrl(value: unknown): string {
  try {
    if (typeof value !== 'string' || value.length > 500) throw new Error('Invalid URL');
    const url = shopUrl(value.trim());
    if (!/\/\d+\/[^/]+\/?$/.test(url.pathname)) throw new Error('Not a product URL');
    return url.href;
  } catch {
    throw new ValidationError({
      reference: 'Bitte gib einen vollständigen HTTPS-Produktlink aus dem Rüsthaus ein.',
    });
  }
}

/** Decodes supported named and valid numeric HTML entities in product metadata. */
function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
    Auml: 'Ä',
    Ouml: 'Ö',
    Uuml: 'Ü',
    szlig: 'ß',
    euro: '€',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, code: string) => {
    if (!code.startsWith('#')) return entities[code] ?? entity;
    const number = code.toLowerCase().startsWith('#x')
      ? parseInt(code.slice(2), 16)
      : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number)
      : entity;
  });
}

/** Shopware exposes the product fields in Open Graph metadata without executing page scripts. */
export function parseRuesthausProduct(html: string, sourceUrl: string): SammelProductInfo {
  const metadata = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of tag[0].matchAll(/\b(property|name|content)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
      attrs.set(attr[1].toLowerCase(), decodeEntities(attr[3]));
    }
    const key = attrs.get('property') ?? attrs.get('name');
    if (key && attrs.has('content')) metadata.set(key.toLowerCase(), attrs.get('content')!);
  }
  const name = metadata.get('og:title')?.trim();
  if (metadata.get('og:type') !== 'product' || !name || name.length > 200)
    throw new Error('Product metadata unavailable');
  let imageUrl: string | null = null;
  try {
    const image = shopUrl(metadata.get('og:image') ?? '');
    if (image.pathname.startsWith('/media/image/') && image.href.length <= 1000)
      imageUrl = image.href;
  } catch {
    /* Missing or foreign image URLs are omitted. */
  }
  const rawPrice = metadata.get('product:price')?.trim();
  const price =
    rawPrice && /^\d[\d.,]*$/.test(rawPrice)
      ? Number(rawPrice.includes(',') ? rawPrice.replace(/\./g, '').replace(',', '.') : rawPrice)
      : NaN;
  const unitPriceCents =
    Number.isFinite(price) && price >= 0 && price <= 100_000 ? Math.round(price * 100) : null;
  return { name, imageUrl, unitPriceCents, sourceUrl };
}

/** Reads a bounded HTML response with an eight-second deadline and validated redirects. */
async function fetchProduct(source: string): Promise<SammelProductInfo> {
  let url = source;
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing shop redirect');
      url = shopUrl(new URL(location, url).href).href;
      continue;
    }
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html') ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error('Shop product unavailable');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_HTML_BYTES) throw new Error('Shop page too large');
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return parseRuesthausProduct(html, url);
  }
  throw new Error('Too many shop redirects');
}

/** Coalesces active product lookups and caches successful metadata for fifteen minutes. */
export async function getRuesthausProduct(source: string): Promise<SammelProductInfo> {
  const url = ruesthausProductUrl(source);
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.product;
  const existing = pending.get(url);
  if (existing) return existing;
  if (pending.size >= 20) throw new Error('Shop lookup capacity exceeded');
  const task = fetchProduct(url);
  pending.set(url, task);
  try {
    const product = await task;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(url, { expiresAt: Date.now() + 15 * 60_000, product });
    return product;
  } finally {
    pending.delete(url);
  }
}
