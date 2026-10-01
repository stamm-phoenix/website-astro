import type { SammelKatalogArtikel } from './types';

const PRODUCT_IMAGES: Record<string, string> = {
  '2891': '/images/sammelbestellungen/2891.webp',
  '3200': '/images/sammelbestellungen/3200.webp',
  '16': '/images/sammelbestellungen/16.webp',
  '17': '/images/sammelbestellungen/17.webp',
  '19': '/images/sammelbestellungen/19.webp',
  '20': '/images/sammelbestellungen/20.webp',
  '26': '/images/sammelbestellungen/26.webp',
  '25': '/images/sammelbestellungen/25.webp',
};

/** Product IDs survive Rüsthaus category changes and existing campaign catalogs. */
export function getSammelProductImage(reference: string): string | undefined {
  try {
    const url = new URL(reference);
    if (url.protocol !== 'https:' || !['ruesthaus.de', 'www.ruesthaus.de'].includes(url.hostname))
      return undefined;
    const id = url.pathname.match(/\/(\d+)\/[^/]+\/?$/)?.[1];
    return id ? PRODUCT_IMAGES[id] : undefined;
  } catch {
    return undefined;
  }
}

/** Starting selection for leaders, reviewed against Rüsthaus on 2026-09-30. No price cache. */
export const SAMMEL_KATALOG: SammelKatalogArtikel[] = [
  {
    name: 'Klufthemd Fairtrade',
    reference: 'https://www.ruesthaus.de/infobereich-sammelbestellen/2891/klufthemd-fairtrade',
    variants: [],
  },
  {
    name: 'Klufthemd Fairtrade KD',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/hemden-blusen/3200/klufthemd-fairtrade-kd',
    variants: [],
  },
  {
    name: 'Halstuch-Knoten Natur',
    reference: 'https://www.ruesthaus.de/infobereich-sammelbestellen/26/halstuch-knoten-natur',
    variants: [],
  },
  {
    name: 'Halstuch-Knoten Dunkelbraun',
    reference:
      'https://www.ruesthaus.de/infobereich-sammelbestellen/25/halstuch-knoten-dunkelbraun',
    variants: [],
  },
];
