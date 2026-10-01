/** Fixed Stamm prices from the supplied inventory list. Shared without platform imports. */
export interface SammelStammProdukt {
  reference: string;
  name: string;
  unitPriceCents: number;
  imageUrl: string;
  limited: boolean;
}
export const SAMMEL_MAX_KATALOG_ARTIKEL = 50;
export const SAMMEL_STAMM_PRODUKTE: readonly SammelStammProdukt[] = [
  {
    reference: 'stamm-halstuch',
    name: 'Stamm Phoenix Halstuch',
    unitPriceCents: 2000,
    imageUrl: '/images/sammelbestellungen/stamm/halstuch.webp',
    limited: false,
  },
  {
    reference: 'stamm-phoenix',
    name: 'Stamm Phoenix Aufnäher',
    unitPriceCents: 300,
    imageUrl: '/images/sammelbestellungen/stamm/phoenix.webp',
    limited: false,
  },
  {
    reference: 'stamm-rosenheim',
    name: 'Bezirk Rosenheim Aufnäher',
    unitPriceCents: 300,
    imageUrl: '/images/sammelbestellungen/stamm/rosenheim.webp',
    limited: false,
  },
  {
    reference: 'stamm-wosm',
    name: 'Weltbund (WOSM) Aufnäher',
    unitPriceCents: 300,
    imageUrl: '/images/sammelbestellungen/stamm/wosm.webp',
    limited: false,
  },
  {
    reference: 'stamm-jubilaeum-25',
    name: '25. Jubiläum Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/jubilaeum-25.webp',
    limited: true,
  },
  {
    reference: 'stamm-jubilaeum-30',
    name: '30. Jubiläum Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/jubilaeum-30.webp',
    limited: true,
  },
  {
    reference: 'stamm-klondike-2011',
    name: 'Klondike-Derby 2011 Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/klondike-2011.webp',
    limited: true,
  },
  {
    reference: 'stamm-klondike-2012',
    name: 'Klondike-Derby 2012 Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/klondike-2012.webp',
    limited: true,
  },
  {
    reference: 'stamm-jahresaktion-2011',
    name: 'Jahresaktion 2011 Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/jahresaktion-2011.webp',
    limited: true,
  },
  {
    reference: 'stamm-jahresaktion-2017',
    name: 'Jahresaktion 2017 Aufnäher',
    unitPriceCents: 200,
    imageUrl: '/images/sammelbestellungen/stamm/jahresaktion-2017.webp',
    limited: true,
  },
  {
    reference: 'stamm-nationalitaet',
    name: 'Nationalität Aufnäher',
    unitPriceCents: 100,
    imageUrl: '/images/sammelbestellungen/stamm/nationalitaet.webp',
    limited: false,
  },
  {
    reference: 'stamm-ikpp',
    name: 'IKPP Aufnäher',
    unitPriceCents: 100,
    imageUrl: '/images/sammelbestellungen/stamm/ikpp.webp',
    limited: false,
  },
];
/** Resolves only known inventory IDs, never prices supplied by an order. */
export function getSammelStammProdukt(reference: string): SammelStammProdukt | undefined {
  return SAMMEL_STAMM_PRODUKTE.find((product) => product.reference === reference.trim());
}
