import { getSammelStammProdukt } from './sammelbestellung-stamm';

/** Supported suppliers; this module is shared by the API and browser without platform imports. */
export const SAMMEL_SHOPS = {
  stamm: { name: 'Stamm Phoenix', url: '/mitgliederbereich/sammelbestellungen', hosts: [] },
  ruesthaus: {
    name: 'Rüsthaus',
    url: 'https://www.ruesthaus.de',
    hosts: ['ruesthaus.de', 'www.ruesthaus.de'],
  },
  eschwege: {
    name: 'Ausrüster Eschwege',
    url: 'https://www.ausruester-eschwege.de',
    hosts: ['ausruester-eschwege.de', 'www.ausruester-eschwege.de'],
  },
} as const;
export type SammelShop = keyof typeof SAMMEL_SHOPS;

/** Infers the supplier from a product link; old article numbers default to Ruesthaus. */
export function getSammelShop(reference: string, shop?: SammelShop): SammelShop {
  if (getSammelStammProdukt(reference)) return 'stamm';
  try {
    const host = new URL(reference).hostname;
    for (const key of Object.keys(SAMMEL_SHOPS) as SammelShop[]) {
      if ((SAMMEL_SHOPS[key].hosts as readonly string[]).includes(host)) return key;
    }
  } catch {
    /* Plain article numbers use the explicitly selected supplier. */
  }
  return shop ?? 'ruesthaus';
}

/** Restricts references to exact HTTPS shop hosts and removes Eschwege session/action parameters. */
export function sammelShopUrl(value: string): URL {
  const url = new URL(value);
  const shop = getSammelShop(value);
  if (
    url.protocol !== 'https:' ||
    !(SAMMEL_SHOPS[shop].hosts as readonly string[]).includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Unsupported shop URL');
  url.hash = '';
  if (shop === 'eschwege') {
    const productId =
      url.pathname === '/product_info.php' ? url.searchParams.get('products_id') : null;
    url.search = '';
    if (productId && /^\d+$/.test(productId)) url.searchParams.set('products_id', productId);
  }
  return url;
}

/** Recognizes product pages without allowing category pages or arbitrary PHP actions. */
export function isSammelProductUrl(value: string): boolean {
  try {
    const url = sammelShopUrl(value);
    if (getSammelShop(url.href) === 'ruesthaus') return /\/\d+\/[^/]+\/?$/.test(url.pathname);
    return (
      /::\d+\.html$/.test(decodeURIComponent(url.pathname)) ||
      (url.pathname === '/product_info.php' &&
        /^\d+$/.test(url.searchParams.get('products_id') ?? ''))
    );
  } catch {
    return false;
  }
}
