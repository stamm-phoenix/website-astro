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
  '3': '/images/sammelbestellungen/3.webp',
  '2': '/images/sammelbestellungen/2.webp',
  '4': '/images/sammelbestellungen/4.webp',
  '2004': '/images/sammelbestellungen/2004.webp',
  '1998': '/images/sammelbestellungen/1998.webp',
  '21': '/images/sammelbestellungen/21.webp',
  '1883': '/images/sammelbestellungen/1883.webp',
  '1996': '/images/sammelbestellungen/1996.webp',
  '28': '/images/sammelbestellungen/28.webp',
  '2003': '/images/sammelbestellungen/2003.webp',
  '2816': '/images/sammelbestellungen/2816.webp',
  '1949': '/images/sammelbestellungen/1949.webp',
  '2729': '/images/sammelbestellungen/2729.webp',
  '1953': '/images/sammelbestellungen/1953.webp',
  '212': '/images/sammelbestellungen/212.webp',
  '2715': '/images/sammelbestellungen/2715.webp',
  '147': '/images/sammelbestellungen/147.webp',
  '1729': '/images/sammelbestellungen/1729.webp',
  '2716': '/images/sammelbestellungen/2716.webp',
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

/** Starting selection from the historical Stamm article list, checked against Rüsthaus on 2026-10-01. No price cache. */
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
  {
    name: 'Kluftbluse Fairtrade',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/hemden-blusen/3/kluftbluse-fairtrade',
    variants: [],
  },
  {
    name: 'Halbarm-Klufthemd Fairtrade',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/hemden-blusen/2/halbarm-klufthemd-fairtrade',
    variants: [],
  },
  {
    name: 'Halbarm-Kluftbluse Fairtrade',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/hemden-blusen/4/halbarm-kluftbluse-fairtrade',
    variants: [],
  },
  {
    name: 'Halstuch rdp Fairtrade',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/halstuecher-knoten/21/halstuch-rdp-fairtrade',
    variants: [],
  },
  {
    name: 'Halstuchring BP',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/halstuecher-knoten/28/halstuchring-bp',
    variants: [],
  },
  {
    name: 'Aufnäher Weltbundabzeichen',
    reference:
      'https://www.ruesthaus.de/infobereich-sammelbestellen/2004/aufnaeher-weltbundabzeichen',
    variants: [],
  },
  {
    name: 'Aufnäher Nationalitäten-Abzeichen',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/aufnaeher-pins/1883/aufnaeher-nationalitaeten-abzeichen',
    variants: [],
  },
  {
    name: 'Aufnäher DPSG rund',
    reference: 'https://www.ruesthaus.de/infobereich-sammelbestellen/1998/aufnaeher-dpsg-rund',
    variants: [],
  },
  {
    name: 'Aufnäher ICCS',
    reference: 'https://www.ruesthaus.de/infobereich-sammelbestellen/1996/aufnaeher-iccs',
    variants: [],
  },
  {
    name: 'Aufnäher Gegen Fremdenfeindlichkeit',
    reference:
      'https://www.ruesthaus.de/infobereich-sammelbestellen/2003/aufnaeher-gegen-fremdenfeindlichkeit',
    variants: [],
  },
  {
    name: 'Aufnäher Baden Powell',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/aufnaeher-pins/1953/aufnaeher-baden-powell',
    variants: [],
  },
  {
    name: 'Aufnäher Abenteuer Jungpfadfinderstufe',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/stufenartikel/jungpfadfinderstufe/2729/aufnaeher-abenteuer-jungpfadfinderstufe',
    variants: [],
  },
  {
    name: 'Aufnäher Rover',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/aufnaeher-pins/1949/aufnaeher-rover',
    variants: [],
  },
  {
    name: 'Pfadfinder-Gürtel',
    reference: 'https://www.ruesthaus.de/infobereich-sammelbestellen/2816/pfadfinder-guertel',
    variants: [],
  },
  {
    name: 'Pfadfinderhut',
    reference: 'https://www.ruesthaus.de/dpsg-artikel/huete-guertel-sonstiges/212/pfadfinderhut',
    variants: [],
  },
  {
    name: 'Rover Hoodie',
    reference: 'https://www.ruesthaus.de/dpsg-artikel/shirts/147/rover-hoodie',
    variants: [],
  },
  {
    name: 'T-Shirt Rover, gerader Schnitt',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/stufenartikel/roverstufe/2715/t-shirt-rover-gerader-schnitt',
    variants: [],
  },
  {
    name: 'T-Shirt Rover, taillierter Schnitt',
    reference:
      'https://www.ruesthaus.de/dpsg-artikel/stufenartikel/roverstufe/2716/t-shirt-rover-taillierter-schnitt',
    variants: [],
  },
  {
    name: 'Ordnung des Verbandes',
    reference: 'https://www.ruesthaus.de/buecher-spiele/1729/ordnung-des-verbandes',
    variants: [],
  },
];
