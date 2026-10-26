import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gesamt,
  imJahr,
  imJahrGesehen,
  inAnsicht,
  jahre,
  kategorieName,
  kategorien,
  keineImJahr,
  sortiere,
  summenImJahr,
  treffer,
} from '../src/lib/kostenstellen';
import type { KostenstelleStatistik } from '../src/lib/types';

const kostenstelle = (
  name: string,
  incomeCent: number,
  expensesCent: number,
  fields: Partial<KostenstelleStatistik> = {}
): KostenstelleStatistik => ({
  id: `cun_${name}`,
  name,
  color: null,
  archived: false,
  incomeCent,
  expensesCent,
  balanceCent: incomeCent + expensesCent,
  openIncomeCent: 0,
  openExpensesCent: 0,
  bookings: 1,
  years: [],
  yearTotals: [],
  categories: [],
  ...fields,
});

const lager = kostenstelle('Stammeslager', 9000, -12000, {
  years: [2025, 2026],
  categories: [
    { id: 'cat_1', name: 'Verpflegung', sphere: 'purpose', ...gesamt([]), yearTotals: [] },
    { id: null, name: '', sphere: null, ...gesamt([]), yearTotals: [] },
  ],
});
const allgemein = kostenstelle('Allgemein', 5000, -100);
const alt = kostenstelle('Lager 2019', 0, -500, { archived: true, years: [2019] });

test('sorts by name or by the chosen sum', () => {
  const names = (list: KostenstelleStatistik[]) => list.map((k) => k.name);
  assert.deepEqual(names(sortiere([lager, alt, allgemein], 'name')), [
    'Allgemein',
    'Lager 2019',
    'Stammeslager',
  ]);
  assert.deepEqual(names(sortiere([alt, allgemein, lager], 'ausgaben')), [
    'Stammeslager',
    'Lager 2019',
    'Allgemein',
  ]);
  assert.deepEqual(names(sortiere([alt, lager, allgemein], 'einnahmen')), [
    'Stammeslager',
    'Allgemein',
    'Lager 2019',
  ]);
  assert.deepEqual(names(sortiere([allgemein, alt, lager], 'saldo')), [
    'Stammeslager',
    'Lager 2019',
    'Allgemein',
  ]);
});

test('filters archived Kostenstellen and searches names of Kategorien too', () => {
  assert.equal(inAnsicht(alt, 'aktuell'), false);
  assert.equal(inAnsicht(alt, 'archiviert'), true);
  assert.equal(inAnsicht(lager, 'archiviert'), false);
  assert.equal(inAnsicht(lager, 'alle'), true);
  assert.equal(treffer(lager, ''), 'name');
  assert.equal(treffer(lager, 'stammes'), 'name');
  assert.equal(treffer(lager, 'verpfleg'), 'kategorie');
  assert.equal(treffer(lager, 'ohne kat'), 'kategorie');
  assert.equal(treffer(allgemein, 'verpfleg'), null);
  assert.equal(kategorieName({ name: '' }), 'Ohne Kategorie');
});

test('adds up the sums of several Kostenstellen', () => {
  assert.deepEqual(gesamt([lager, allgemein]), {
    incomeCent: 14000,
    expensesCent: -12100,
    balanceCent: 1900,
    openIncomeCent: 0,
    openExpensesCent: 0,
    bookings: 2,
  });
});

test('filters by the years with bookings, keeping every Kategorie', () => {
  assert.equal(imJahr(lager, null), true);
  assert.equal(imJahr(lager, 2025), true);
  assert.equal(imJahr(lager, 2019), false);
  assert.equal(imJahr(allgemein, 2026), false);
  assert.deepEqual(jahre([alt, lager, allgemein]), [2026, 2025, 2019]);
  assert.equal(keineImJahr('aktuell', 2024), 'Keine aktuelle Kostenstelle hat Buchungen aus 2024.');
  assert.equal(keineImJahr('alle', 2024), 'Keine Kostenstelle hat Buchungen aus 2024.');
});

test('the sums of one year come from the yearly totals, none without bookings that year', () => {
  const jahr2025 = { ...gesamt([]), incomeCent: 4000, balanceCent: 4000, bookings: 2 };
  const mitJahren = { ...lager, yearTotals: [{ year: 2025, ...jahr2025 }] };
  assert.deepEqual(summenImJahr(mitJahren, 2025), jahr2025);
  assert.deepEqual(summenImJahr(mitJahren, 2024), gesamt([]));
  assert.equal(summenImJahr(mitJahren, null), mitJahren);
  assert.equal(
    gesamt([summenImJahr(mitJahren, 2025), summenImJahr(allgemein, 2025)]).incomeCent,
    4000
  );
});

test('with a year chosen, the Kostenstelle and all its Kategorien show only that year', () => {
  const kat = (name: string, cent: number, years: number[]) => ({
    id: `cat_${name}`,
    name,
    sphere: null,
    ...gesamt([]),
    incomeCent: cent * years.length,
    balanceCent: cent * years.length,
    bookings: years.length,
    yearTotals: years.map((year) => ({
      year,
      ...gesamt([]),
      incomeCent: cent,
      balanceCent: cent,
      bookings: 1,
    })),
  });
  const k = kostenstelle('Lager', 0, 0, {
    years: [2024, 2025],
    yearTotals: [
      { year: 2024, ...gesamt([]), incomeCent: 100, balanceCent: 100, bookings: 1 },
      { year: 2025, ...gesamt([]), incomeCent: 300, balanceCent: 300, bookings: 2 },
    ],
    categories: [kat('A', 100, [2024, 2025]), kat('B', 200, [2025])],
  });
  assert.equal(imJahrGesehen(k, null), k);
  const y2024 = imJahrGesehen(k, 2024);
  assert.equal(y2024.incomeCent, 100);
  assert.equal(y2024.bookings, 1);
  assert.deepEqual(
    y2024.categories.map((c) => [c.name, c.incomeCent, c.bookings]),
    [
      ['A', 100, 1],
      ['B', 0, 0],
    ]
  );
  assert.equal(imJahrGesehen(k, 2025).categories[1].incomeCent, 200);
});

test('bookings without a Kategorie and a deleted Kategorie „Ohne Kategorie“ stay apart', () => {
  const ohne = { id: null, name: '', sphere: null, ...gesamt([]), incomeCent: 100, yearTotals: [] };
  const geloescht = { ...ohne, name: 'Ohne Kategorie', incomeCent: 200 };
  const liste = kategorien(
    kostenstelle('Lager', 300, 0, { categories: [ohne, geloescht] }),
    'name'
  );
  assert.equal(liste.length, 2);
  assert.equal(new Set(liste.map((k) => k.key)).size, 2);
  assert.deepEqual(liste.map((k) => k.incomeCent).sort(), [100, 200]);
});
