/** Sammelbestellungen (campaigns and orders) of the mock API. */
import type {
  SammelAktion,
  SammelArtikel,
  SammelBestellung,
  SammelKatalogArtikel,
  SammelProductInfo,
  SammelStatus,
} from '../../src/lib/types';
import { SAMMEL_KATALOG, getSammelProductImage } from '../../src/lib/sammelKatalog';
import { hashString } from './svg';
import { isoFromNow, newEtag, newId } from './util';

const SIZES_KIDS = ['128', '140', '152', '164'];
const SIZES_ADULT = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function catalogItem(name: string, variants: string[] = []): SammelKatalogArtikel {
  const item = SAMMEL_KATALOG.find((k) => k.name === name);
  if (!item) throw new Error(`Mock catalog item ${name} missing`);
  return { ...item, shop: 'ruesthaus', variants };
}

const KLUFT_CATALOG: SammelKatalogArtikel[] = [
  catalogItem('Klufthemd Fairtrade', [...SIZES_KIDS, ...SIZES_ADULT]),
  catalogItem('Kluftbluse Fairtrade', ['34', '36', '38', '40', '42', '44']),
  catalogItem('Halstuch-Knoten Natur'),
  catalogItem('Halstuch-Knoten Dunkelbraun'),
  catalogItem('Aufnäher Weltbundabzeichen'),
  catalogItem('Aufnäher DPSG rund'),
  catalogItem('Pfadfinder-Gürtel', ['80 cm', '90 cm', '100 cm', '110 cm']),
  catalogItem('Pfadfinderhut', ['54', '56', '58', '60']),
];

const ROVER_CATALOG: SammelKatalogArtikel[] = [
  catalogItem('Rover Hoodie', SIZES_ADULT),
  catalogItem('T-Shirt Rover, gerader Schnitt', SIZES_ADULT),
  catalogItem('T-Shirt Rover, taillierter Schnitt', ['XS', 'S', 'M', 'L', 'XL']),
  catalogItem('Aufnäher Rover'),
];

const ESCHWEGE_ITEM: SammelKatalogArtikel = {
  shop: 'eschwege',
  name: 'Kothe schwarz, 4-Mann',
  reference: 'https://www.ausruester-eschwege.de/product_info.php?products_id=1234',
  variants: [],
};

export const campaigns: SammelAktion[] = [
  {
    id: '101',
    etag: newEtag('sammel-101'),
    title: 'Kluft & Halstücher Herbst 2026',
    description:
      'Unsere große Sammelbestellung beim Rüsthaus: Klufthemden, Knoten, Aufnäher und mehr. Bitte bestellt die Größe lieber eine Nummer größer – die Kinder wachsen schnell! Abholung nach der Gruppenstunde.',
    startsAt: isoFromNow(-10),
    endsAt: isoFromNow(18),
    catalog: KLUFT_CATALOG,
    archived: false,
  },
  {
    id: '102',
    etag: newEtag('sammel-102'),
    title: 'Rover-Hoodies 2026',
    description: 'Einheitliche Hoodies für die Roverrunde.',
    startsAt: isoFromNow(12),
    endsAt: isoFromNow(40),
    catalog: ROVER_CATALOG,
    archived: false,
  },
  {
    id: '103',
    etag: newEtag('sammel-103'),
    title: 'Lagerausrüstung Frühjahr 2026',
    description:
      'Gemeinsame Bestellung für Zelte und Ausrüstung bei Rüsthaus und Ausrüster Eschwege. Die Ware ist inzwischen eingetroffen.',
    startsAt: isoFromNow(-160),
    endsAt: isoFromNow(-130),
    catalog: [...KLUFT_CATALOG.slice(0, 3), ESCHWEGE_ITEM],
    archived: false,
  },
  {
    id: '104',
    etag: newEtag('sammel-104'),
    title: 'Sommerlager-T-Shirts 2025',
    description: '',
    startsAt: isoFromNow(-420),
    endsAt: isoFromNow(-400),
    catalog: ROVER_CATALOG.slice(1, 2),
    archived: true,
  },
];

function art(
  campaign: SammelAktion,
  index: number,
  variant: string,
  quantity: number,
  excluded?: string
): SammelArtikel {
  const item = campaign.catalog[index];
  return {
    shop: item.shop,
    name: item.name,
    reference: item.reference,
    variant,
    quantity,
    ...(excluded !== undefined ? { excluded: { reason: excluded } } : {}),
  };
}

const [C101, C102, C103, C104] = campaigns;

interface OrderSeed {
  id: string;
  campaign: SammelAktion;
  name: string;
  email: string;
  items: SammelArtikel[];
  notes?: string;
  status?: SammelStatus;
  submitted?: boolean;
  paid?: boolean;
  delivered?: boolean;
  totalCents?: number | null;
}

const ORDER_SEEDS: OrderSeed[] = [
  {
    id: '2001',
    campaign: C101,
    name: 'Familie Huber (Lena, Paul)',
    email: 'familie.huber@example.org',
    items: [art(C101, 0, '140', 1), art(C101, 2, '', 2), art(C101, 4, '', 1)],
    notes: 'Paul braucht das Hemd bis zur Versprechensfeier, falls möglich.',
  },
  {
    id: '2002',
    campaign: C101,
    name: 'Mia Bauer',
    email: 'familie.bauer@example.org',
    items: [art(C101, 0, '128', 1)],
  },
  {
    id: '2003',
    campaign: C101,
    name: 'Familie Mayr',
    email: 'familie.mayr@example.org',
    items: [
      art(C101, 0, '152', 1),
      art(C101, 0, '128', 1),
      art(C101, 3, '', 2),
      art(C101, 6, '90 cm', 1, 'Der Gürtel ist beim Rüsthaus derzeit nicht lieferbar.'),
    ],
    status: 'Bestellt',
    totalCents: 11_870,
  },
  {
    id: '2004',
    campaign: C101,
    name: 'Korbinian Strasser',
    email: 'k.strasser@example.org',
    items: [art(C101, 1, '38', 1), art(C101, 5, '', 3), art(C101, 7, '58', 1)],
    paid: true,
    totalCents: 9_340,
  },
  {
    id: '2005',
    campaign: C101,
    name: 'Familie Holzner',
    email: 'holzner@example.org',
    items: [],
    submitted: false,
  },
  {
    id: '2006',
    campaign: C101,
    name: 'Valentin Aigner',
    email: 'valentin.aigner@example.org',
    items: [art(C101, 0, 'M', 1)],
    status: 'Storniert',
    notes: 'Hat sich erledigt, wir haben ein gebrauchtes Hemd bekommen.',
  },
  {
    id: '2007',
    campaign: C101,
    name: 'Theresa Lechner (Leitung)',
    email: 'theresa.lechner@example.org',
    items: [art(C101, 2, '', 10), art(C101, 3, '', 10), art(C101, 4, '', 15), art(C101, 5, '', 15)],
    notes: 'Vorrat für neue Mitglieder, Abrechnung über die Stammeskasse.',
  },
  {
    id: '2101',
    campaign: C103,
    name: 'Familie Brunner',
    email: 'brunner@example.org',
    items: [art(C103, 0, '164', 1), art(C103, 3, '', 1)],
    status: 'Eingetroffen',
    paid: true,
    delivered: true,
    totalCents: 31_480,
  },
  {
    id: '2102',
    campaign: C103,
    name: 'Familie Kammerer',
    email: 'kammerer@example.org',
    items: [art(C103, 1, '36', 1), art(C103, 2, '', 1)],
    status: 'Eingetroffen',
    paid: false,
    delivered: true,
    totalCents: 4_890,
  },
  {
    id: '2103',
    campaign: C103,
    name: 'Tobias Weiß',
    email: 'tobias.weiss@example.org',
    items: [art(C103, 0, 'L', 1)],
    status: 'Bestellt',
    paid: true,
    totalCents: 3_990,
  },
  {
    id: '2201',
    campaign: C104,
    name: 'Benedikt Hofstetter',
    email: 'b.hofstetter@example.org',
    items: [art(C104, 0, 'L', 2)],
    status: 'Eingetroffen',
    paid: true,
    delivered: true,
    totalCents: 4_400,
  },
  {
    id: '2202',
    campaign: C102,
    name: 'Hugo Berendi',
    email: 'hugo@example.org',
    items: [],
    submitted: false,
  },
];

export const orders: SammelBestellung[] = ORDER_SEEDS.map((seed) => ({
  id: seed.id,
  etag: newEtag(`order-${seed.id}`),
  campaignId: seed.campaign.id,
  name: seed.name,
  email: seed.email,
  items: seed.items,
  notes: seed.notes ?? '',
  status: seed.status ?? 'Eingereicht',
  submitted: seed.submitted ?? true,
  paid: seed.paid ?? false,
  delivered: seed.delivered ?? false,
  totalCents: seed.totalCents ?? null,
}));

export function touchCampaign(campaign: SammelAktion): void {
  campaign.etag = newEtag(`sammel-${campaign.id}`);
}

export function touchOrder(order: SammelBestellung): void {
  order.etag = newEtag(`order-${order.id}`);
}

export function createCampaign(body: Record<string, unknown>): SammelAktion {
  const catalog = Array.isArray(body.catalog) ? (body.catalog as SammelKatalogArtikel[]) : [];
  const campaign: SammelAktion = {
    id: newId(),
    etag: '',
    title: typeof body.title === 'string' ? body.title : 'Neue Sammelbestellung',
    description: typeof body.description === 'string' ? body.description : '',
    startsAt: typeof body.startsAt === 'string' ? body.startsAt : isoFromNow(0),
    endsAt: typeof body.endsAt === 'string' ? body.endsAt : isoFromNow(14),
    catalog,
    archived: false,
  };
  touchCampaign(campaign);
  campaigns.push(campaign);
  return campaign;
}

const PRICES: [RegExp, number][] = [
  [/hoodie/i, 4990],
  [/hut/i, 4490],
  [/kluft(hemd|bluse)|hemd|bluse/i, 3990],
  [/gürtel/i, 2490],
  [/t-shirt/i, 1990],
  [/halstuch-knoten|ring/i, 590],
  [/halstuch/i, 1290],
  [/aufnäher/i, 320],
  [/kothe|zelt/i, 38900],
];

/** Rough Rüsthaus price for an article name, with a few cents of variation. */
function typicalPrice(name: string, h: number): number {
  const base = PRICES.find(([pattern]) => pattern.test(name))?.[1] ?? 990 + (h % 30) * 100;
  return base + (h % 3) * 10;
}

/** Plausible shop data for a product link, with local product images. */
export function productInfo(reference: string): SammelProductInfo {
  const h = hashString(reference);
  const known = SAMMEL_KATALOG.find((k) => k.reference === reference);
  const name =
    known?.name ??
    decodeURIComponent(reference.split('/').filter(Boolean).pop() ?? 'Artikel')
      .replace(/[-_]/g, ' ')
      .replace(/\.html?$/, '')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const availability = known
    ? (['available', 'available', 'available', 'preorder'] as const)[h % 4]
    : (['available', 'preorder', 'unavailable', 'unknown'] as const)[h % 4];
  return {
    availability,
    name,
    imageUrl: getSammelProductImage(reference) ?? null,
    // Prices between 2,90 € and 59,90 €; one in seven products has no price
    unitPriceCents: !known && h % 7 === 3 ? null : typicalPrice(name, h),
    sourceUrl: reference,
  };
}

/** Invitation delivery state per campaign. */
export const invitations = new Map<string, { total: number; sent: number; version: number }>();
