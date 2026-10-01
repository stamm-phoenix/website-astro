import { getSammelShop, sammelShopUrl, isSammelProductUrl } from './sammelbestellung-shops';
import { ValidationError } from './pflege-validation';
import type { SammelProductInfo } from './sammelbestellung-model';

interface CachedProduct {
  expiresAt: number;
  product: SammelProductInfo;
}

const cache = new Map<string, CachedProduct>();
const pending = new Map<string, Promise<SammelProductInfo>>();
const MAX_HTML_BYTES = 2_000_000;

/** Requires a bounded product URL belonging to one of the supported suppliers. */
export function shopProductUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500 || !isSammelProductUrl(value.trim()))
    throw new ValidationError({
      reference:
        'Bitte gib einen vollständigen HTTPS-Produktlink zu Rüsthaus oder Ausrüster Eschwege ein.',
    });
  return sammelShopUrl(value.trim()).href;
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
    const image = sammelShopUrl(metadata.get('og:image') ?? '');
    if (
      getSammelShop(image.href) === 'ruesthaus' &&
      image.pathname.startsWith('/media/image/') &&
      image.href.length <= 1000
    )
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

/** Reads primary modified-shop product microdata, including the current discounted offer price. */
export function parseEschwegeProduct(html: string, sourceUrl: string): SammelProductInfo {
  const productStart = html.search(/<[^>]+itemtype=["']https?:\/\/schema\.org\/Product["'][^>]*>/i);
  if (productStart < 0) throw new Error('Product metadata unavailable');
  const productHtml = html.slice(productStart).split(/<\/form>/i)[0];
  const heading = productHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const name = heading ? decodeEntities(heading.replace(/<[^>]*>/g, '')).trim() : '';
  if (!name || name.length > 200) throw new Error('Product metadata unavailable');
  const metadata = new Map<string, string>();
  for (const tag of productHtml.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of tag[0].matchAll(/\b(itemprop|content)\s*=\s*(["'])([\s\S]*?)\2/gi))
      attrs.set(attr[1].toLowerCase(), decodeEntities(attr[3]));
    const key = attrs.get('itemprop');
    if (key && attrs.has('content') && !metadata.has(key)) metadata.set(key, attrs.get('content')!);
  }
  const rawPrice = metadata.get('price') ?? '';
  const price = /^\d+(?:\.\d{1,2})?$/.test(rawPrice) ? Number(rawPrice) : NaN;
  const unitPriceCents =
    metadata.get('priceCurrency') === 'EUR' && Number.isFinite(price) && price <= 100_000
      ? Math.round(price * 100)
      : null;
  let imageUrl: string | null = null;
  for (const tag of productHtml.matchAll(/<img\b[^>]*>/gi)) {
    const src = tag[0].match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    if (!src) continue;
    try {
      const image = sammelShopUrl(new URL(decodeEntities(src), sourceUrl).href);
      if (
        getSammelShop(image.href) === 'eschwege' &&
        image.pathname.startsWith('/images/product_images/') &&
        image.href.length <= 1000
      ) {
        imageUrl = image.href;
        break;
      }
    } catch {
      /* Ignore foreign or unsupported images. */
    }
  }
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
      const nextUrl = sammelShopUrl(new URL(location, url).href).href;
      if (getSammelShop(nextUrl) !== getSammelShop(source))
        throw new Error('Cross-supplier redirect');
      url = nextUrl;
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
    return getSammelShop(url) === 'eschwege'
      ? parseEschwegeProduct(html, url)
      : parseRuesthausProduct(html, url);
  }
  throw new Error('Too many shop redirects');
}

/** Coalesces active product lookups and caches successful metadata for fifteen minutes. */
export async function getShopProduct(source: string): Promise<SammelProductInfo> {
  const url = shopProductUrl(source);
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
