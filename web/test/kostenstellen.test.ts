import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gesamt,
  imJahr,
  inAnsicht,
  jahre,
  kategorieName,
  keineImJahr,
  sortiere,
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
  categories: [],
  ...fields,
});

const lager = kostenstelle('Stammeslager', 9000, -12000, {
  years: [2025, 2026],
  categories: [
    { id: 'cat_1', name: 'Verpflegung', sphere: 'purpose', ...gesamt([]) },
    { id: null, name: '', sphere: null, ...gesamt([]) },
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
