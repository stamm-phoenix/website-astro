// PDFs of a Sammelbestellung: the order list per shop, to send or file, and the list to hand
// the orders out, with an empty column to tick off or sign.
import { formatEuro } from './format';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport, PdfSection } from './pdfTabelle';
import { sammelReceipt } from './sammelExport';
import { SAMMEL_SHOPS, getSammelShop } from './sammelShops';
import type { SammelShop } from './sammelShops';
import { ORDER_FILTERS } from './sammelStaffView';
import type { SammelOrderFilters } from './sammelStaffView';
import type { SammelArtikel, SammelBestellung } from './types';

export interface BestelllisteInput {
  campaignTitle: string;
  /** The shop chosen for the table, or all. */
  shop: SammelShop | 'all';
  /** The combined articles of all orders. */
  items: SammelArtikel[];
  prices: Record<string, number | null>;
  /** The price of one or `quantity` pieces as the page shows it, e.g. „Preis fehlt“. */
  linePrice: (reference: string, quantity?: number) => string;
}

function sumLabel(missing: number): string {
  return missing ? 'Zwischensumme bekannter Preise' : 'Summe';
}

/** One section per shop with its articles and their sum; the total at the end. */
export function bestelllistePdf(input: BestelllisteInput): PdfReport {
  const byShop = new Map<SammelShop, SammelArtikel[]>();
  for (const item of input.items) {
    const shop = getSammelShop(item.reference, item.shop);
    if (input.shop !== 'all' && shop !== input.shop) continue;
    byShop.set(shop, [...(byShop.get(shop) ?? []), item]);
  }
  const all = [...byShop.values()].flat();
  const total = sammelReceipt(all, input.prices);
  const pieces = all.reduce((sum, item) => sum + item.quantity, 0);
  const sections: PdfSection[] = [...byShop].map(([shop, items]) => {
    const receipt = sammelReceipt(items, input.prices);
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      heading: SAMMEL_SHOPS[shop].name,
      lines: [
        `${items.length} Artikel · ${count} Stück${receipt.missingPositions ? ` · ${receipt.missingPositions} ohne Preis` : ''}`,
      ],
      columns: ['Artikel', 'Variante', 'Anzahl', 'Stückpreis', 'Summe'],
      rows: items.map((item) => [
        `${item.name}\n${item.reference}`,
        item.variant || '–',
        String(item.quantity),
        input.linePrice(item.reference),
        input.linePrice(item.reference, item.quantity),
      ]),
      foot: [
        [
          sumLabel(receipt.missingPositions),
          '',
          String(count),
          '',
          formatEuro(receipt.subtotalCents),
        ],
      ],
      alignRight: [2, 3, 4],
      widths: { 1: 34, 2: 16, 3: 24, 4: 24 },
    };
  });
  const notes = [
    'Stammesartikel mit Listenpreis, Shop-Artikel mit aktuellem Richtpreis, ohne Versand. Variantenpreise bitte prüfen.',
  ];
  if (total.missingPositions) {
    notes.push(`${total.missingPositions} Artikel ohne Preis, Summe noch unvollständig.`);
  }
  const shopName = input.shop === 'all' ? '' : SAMMEL_SHOPS[input.shop].name;
  return {
    title: `Bestellliste – ${input.campaignTitle}`,
    subtitle: [
      shopName || 'Alle Anbieter',
      `${all.length} Artikel`,
      `${pieces} Stück`,
      `${sumLabel(total.missingPositions)} ${formatEuro(total.subtotalCents)}`,
    ].join(' · '),
    notes,
    sections,
    fileName: pdfFileName('Bestellliste', input.campaignTitle, shopName),
  };
}

export async function downloadBestellliste(input: BestelllisteInput): Promise<void> {
  await downloadReportPdf(bestelllistePdf(input));
}

export interface AusgabelisteInput {
  campaignTitle: string;
  /** The orders the list shows with its filters. */
  orders: SammelBestellung[];
  filters: SammelOrderFilters;
}

/** The active search and filters in words, so the paper says what is missing. */
function filterNotes(filters: SammelOrderFilters, skipped: number): string[] {
  const active = ORDER_FILTERS.filter((filter) => filters.activeFilters[filter.key]).map(
    (filter) => filter.label
  );
  const notes: string[] = [];
  if (active.length) notes.push(`Nur: ${active.join(', ')}`);
  if (filters.search.trim()) notes.push(`Suche: „${filters.search.trim()}“`);
  if (!filters.showFinished) notes.push('Ohne erledigte Bestellungen');
  if (skipped) {
    notes.push(
      skipped === 1
        ? '1 stornierte Bestellung ist nicht enthalten.'
        : `${skipped} stornierte Bestellungen sind nicht enthalten.`
    );
  }
  return notes;
}

/** One row per person with what they get, the amount, whether it is paid and room to sign. */
export function ausgabelistePdf(input: AusgabelisteInput): PdfReport {
  const orders = input.orders
    .filter((order) => order.status !== 'Storniert')
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const skipped = input.orders.length - orders.length;
  let pieces = 0;
  let totalCents = 0;
  let openCents = 0;
  const rows = orders.map((order) => {
    const items = order.items.filter((item) => !item.excluded);
    pieces += items.reduce((sum, item) => sum + item.quantity, 0);
    totalCents += order.totalCents ?? 0;
    if (!order.paid) openCents += order.totalCents ?? 0;
    return [
      order.name,
      items
        .map((item) => `${item.quantity} × ${item.name}${item.variant ? ` · ${item.variant}` : ''}`)
        .join('\n') || '–',
      order.totalCents === null ? 'ohne Betrag' : formatEuro(order.totalCents),
      order.paid ? 'Ja' : 'Nein',
      order.delivered ? 'ausgeliefert' : '',
    ];
  });
  const open = orders.filter((order) => !order.paid).length;
  return {
    title: `Ausgabeliste – ${input.campaignTitle}`,
    subtitle: `${orders.length} ${orders.length === 1 ? 'Bestellung' : 'Bestellungen'} · ${pieces} Stück · ${open} unbezahlt`,
    notes: filterNotes(input.filters, skipped),
    sections: [
      {
        columns: ['Name', 'Artikel', 'Betrag', 'Bezahlt', 'Erhalten'],
        rows,
        foot: [
          [
            `${orders.length} ${orders.length === 1 ? 'Bestellung' : 'Bestellungen'}`,
            `${pieces} Stück`,
            formatEuro(totalCents),
            openCents ? `${formatEuro(openCents)} offen` : '',
            '',
          ],
        ],
        alignRight: [2],
        // A wide empty column to tick off or sign
        widths: { 0: 40, 2: 22, 3: 24, 4: 30 },
      },
    ],
    fileName: pdfFileName('Ausgabeliste', input.campaignTitle),
  };
}

export async function downloadAusgabeliste(input: AusgabelisteInput): Promise<void> {
  await downloadReportPdf(ausgabelistePdf(input));
}
