import type { SammelKatalogArtikel } from './types';

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
  ...[
    ['Halstuch Wölflinge Fairtrade', '16/halstuch-woelflinge-fairtrade'],
    ['Halstuch Jungpfadfinder Fairtrade', '17/halstuch-jungpfadfinder-fairtrade'],
    ['Halstuch Pfadi Fairtrade', '19/halstuch-pfadi-fairtrade'],
    ['Halstuch Rover Fairtrade', '20/halstuch-rover-fairtrade'],
  ].map(([name, path]) => ({
    name,
    reference: `https://www.ruesthaus.de/dpsg-artikel/pfadfinderkluft/halstuecher-knoten/${path}`,
    variants: [],
  })),
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
