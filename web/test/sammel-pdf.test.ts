import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ausgabelistePdf, bestelllistePdf } from '../src/lib/sammelPdf';
import type { SammelOrderFilters } from '../src/lib/sammelStaffView';
import type { SammelArtikel, SammelBestellung } from '../src/lib/types';

/** The report with plain spaces, as Intl puts a no-break space before the €. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('\u00a0', ' ')) as T;
}

const RUESTHAUS = 'https://www.ruesthaus.de/123/kluft/';

const items: SammelArtikel[] = [
  { name: 'Halstuch', reference: 'stamm-halstuch', variant: '', quantity: 3 },
  { name: 'Kluft', reference: RUESTHAUS, variant: 'M', quantity: 2 },
  { name: 'Hose', reference: '4711', variant: '', quantity: 1, shop: 'eschwege' },
];
const prices: Record<string, number | null> = { [RUESTHAUS]: 4500, '4711': null };
const linePrice = (reference: string, quantity = 1): string => `${reference}×${quantity}`;

describe('bestelllistePdf', () => {
  test('lists every shop with its articles and its sum', () => {
    const report = plain(
      bestelllistePdf({
        campaignTitle: 'Kluft 2026',
        shop: 'all',
        items,
        prices,
        linePrice,
      })
    );
    assert.equal(report.title, 'Bestellliste – Kluft 2026');
    // In the order of the combined list on the page
    assert.deepEqual(
      report.sections.map((section) => section.heading),
      ['Stamm Phoenix', 'Rüsthaus', 'Ausrüster Eschwege']
    );
    const ruesthaus = report.sections[1];
    assert.deepEqual(ruesthaus.rows, [
      [`Kluft\n${RUESTHAUS}`, 'M', '2', `${RUESTHAUS}×1`, `${RUESTHAUS}×2`],
    ]);
    assert.deepEqual(ruesthaus.foot, [['Summe', '', '2', '', '90,00 €']]);
    // A missing price leaves the sum of its shop and of the whole list incomplete
    assert.equal(report.sections[2].foot?.[0][0], 'Zwischensumme bekannter Preise');
    assert.equal(report.sections[0].foot?.[0][0], 'Summe');
    assert.match(report.subtitle, /6 Stück · Zwischensumme bekannter Preise 150,00 €$/);
    assert.ok(report.notes?.includes('1 Artikel ohne Preis, Summe noch unvollständig.'));
    assert.equal(report.fileName, 'Bestellliste Kluft 2026.pdf');
  });

  test('keeps only the chosen shop', () => {
    const report = plain(
      bestelllistePdf({
        campaignTitle: 'Kluft 2026',
        shop: 'stamm',
        items,
        prices,
        linePrice,
      })
    );
    assert.equal(report.sections.length, 1);
    assert.match(report.subtitle, /^Stamm Phoenix · 1 Artikel · 3 Stück · Summe 60,00 €$/);
    assert.equal(report.fileName, 'Bestellliste Kluft 2026 Stamm Phoenix.pdf');
  });
});

function order(id: string, extra: Partial<SammelBestellung> = {}): SammelBestellung {
  return {
    id,
    etag: 'e',
    campaignId: '1',
    name: `Person ${id}`,
    email: `${id}@example.org`,
    items: [{ name: 'Halstuch', reference: 'stamm-halstuch', variant: '', quantity: 1 }],
    notes: '',
    status: 'Eingetroffen',
    submitted: true,
    paid: false,
    delivered: false,
    totalCents: 2000,
    ...extra,
  };
}

const filters: SammelOrderFilters = {
  search: '',
  showFinished: true,
  activeFilters: { submitted: false, unpriced: false, unpaid: false, undelivered: false },
};

describe('ausgabelistePdf', () => {
  test('lists each person once with what they get and an empty column to sign', () => {
    const report = plain(
      ausgabelistePdf({
        campaignTitle: 'Kluft 2026',
        orders: [
          order('b', {
            paid: true,
            delivered: true,
            items: [
              { name: 'Kluft', reference: RUESTHAUS, variant: 'M', quantity: 2 },
              {
                name: 'Hose',
                reference: '4711',
                variant: '',
                quantity: 1,
                excluded: { reason: 'aus' },
              },
            ],
            totalCents: 9000,
          }),
          order('a', { totalCents: null }),
          order('c', { status: 'Storniert' }),
        ],
        filters,
      })
    );
    const table = report.sections[0];
    assert.deepEqual(table.columns, ['Name', 'Artikel', 'Betrag', 'Bezahlt', 'Erhalten']);
    assert.deepEqual(table.rows, [
      ['Person a', '1 × Halstuch', 'ohne Betrag', 'Nein', ''],
      ['Person b', '2 × Kluft · M', '90,00 €', 'Ja', 'ausgeliefert'],
    ]);
    assert.deepEqual(table.foot, [['2 Bestellungen', '3 Stück', '90,00 €', '', '']]);
    assert.equal(report.subtitle, '2 Bestellungen · 3 Stück · 1 unbezahlt');
    assert.deepEqual(report.notes, ['1 stornierte Bestellung ist nicht enthalten.']);
  });

  test('names the active search and filters', () => {
    const report = plain(
      ausgabelistePdf({
        campaignTitle: 'Kluft 2026',
        orders: [order('a')],
        filters: {
          search: ' Anna ',
          showFinished: false,
          activeFilters: { submitted: false, unpriced: false, unpaid: true, undelivered: true },
        },
      })
    );
    assert.deepEqual(report.notes, [
      'Nur: Unbezahlt, Nicht ausgeliefert',
      'Suche: „Anna“',
      'Ohne erledigte Bestellungen',
    ]);
    assert.deepEqual(report.sections[0].foot?.[0].slice(2, 4), ['20,00 €', '20,00 € offen']);
  });
});
