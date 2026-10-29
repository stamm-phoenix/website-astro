import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { kostenstellenPdf } from '../src/lib/kostenstellenPdf';
import type {
  KategorieStatistik,
  KostenstelleStatistik,
  KostenstellenSummen,
} from '../src/lib/types';

/** The report with plain spaces, as Intl puts a no-break space before the €. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('\u00a0', ' ')) as T;
}

function summen(
  incomeCent: number,
  expensesCent: number,
  extra: Partial<KostenstellenSummen> = {}
) {
  return {
    incomeCent,
    expensesCent,
    balanceCent: incomeCent + expensesCent,
    openIncomeCent: 0,
    openExpensesCent: 0,
    bookings: 2,
    ...extra,
  };
}

function kategorie(name: string, sums: KostenstellenSummen): KategorieStatistik {
  return { id: name || null, name, sphere: name ? 'ideal' : null, yearTotals: [], ...sums };
}

const lager: KostenstelleStatistik = {
  id: 'k1',
  name: 'Sommerlager',
  color: null,
  archived: false,
  years: [2026],
  yearTotals: [],
  ...summen(50000, -30000, { openIncomeCent: 10000, bookings: 4 }),
  categories: [
    kategorie('Verpflegung', summen(0, -30000)),
    kategorie('', summen(50000, 0, { openIncomeCent: 10000 })),
  ],
};
const alt: KostenstelleStatistik = {
  id: null,
  name: 'Altes Zelt',
  color: null,
  archived: true,
  years: [2024],
  yearTotals: [],
  ...summen(0, -5000, { bookings: 1 }),
  categories: [],
};

describe('kostenstellenPdf', () => {
  const report = plain(
    kostenstellenPdf({
      kostenstellen: [lager, alt],
      ansicht: 'alle',
      jahr: 2026,
      suche: '',
      sortierung: 'ausgaben',
      loadedAt: '2026-10-29T09:30:00Z',
    })
  );

  test('starts with an overview of all Kostenstellen and their sum', () => {
    const overview = report.sections[0];
    assert.equal(report.title, 'Kostenstellen 2026');
    assert.deepEqual(report.notes, [
      'Alle Kostenstellen · nur Buchungen aus 2026 · Sortierung: Höchste Ausgaben',
    ]);
    assert.deepEqual(overview.rows, [
      ['Sommerlager', '4', '500,00 €', '-300,00 €', '200,00 €', '100,00 €', ''],
      ['Altes Zelt (archiviert)', '1', '0,00 €', '-50,00 €', '-50,00 €', '', ''],
    ]);
    assert.deepEqual(overview.foot, [
      ['Summe aus 2 Kostenstellen', '5', '500,00 €', '-350,00 €', '150,00 €', '100,00 €', ''],
    ]);
    assert.equal(report.fileName, 'Kostenstellen 2026.pdf');
  });

  test('gives each Kostenstelle its Kategorien, sorted like the page', () => {
    const [, first, second] = report.sections;
    assert.equal(first.heading, 'Sommerlager');
    assert.equal(first.newPage, true);
    assert.deepEqual(
      first.rows?.map((row) => row.slice(0, 2)),
      [
        ['Verpflegung', 'Ideeller Bereich'],
        ['Ohne Kategorie', ''],
      ]
    );
    assert.deepEqual(first.foot?.[0].slice(0, 3), ['Summe', '', '4']);
    assert.equal(second.heading, 'Altes Zelt');
    assert.equal(second.columns, undefined);
    assert.deepEqual(second.lines, [
      '1 Buchung · 0 Kategorien · Archiviert · nicht mehr in CampFlow',
      'Keine Kategorien.',
    ]);
  });
});
