import assert from 'node:assert/strict';
import test from 'node:test';
import { readKostenstellenSummen } from '../lib/kostenstellen';
import { PlaywrightApiError } from '../lib/playwright-api';

const sums = (income = 0, expenses = 0, bookings = 0) => ({
  income,
  expenses,
  balance: 12345,
  openIncome: 0.1,
  openExpenses: -0.2,
  bookings,
});
const YEAR = { year: 2026, ...sums(10, -4.5, 2) };
const KATEGORIE = {
  id: 'cat_1',
  name: '  Fahrt  ',
  sphere: 'purpose',
  ...sums(10, -4.5, 2),
  yearTotals: [YEAR],
};
const UNIT = {
  id: 'cun_1',
  name: ' Lager ',
  color: '#EAB308',
  archived: false,
  ...sums(10, -4.5, 2),
  years: [2025, 2026],
  yearTotals: [YEAR],
  categories: [KATEGORIE],
};
const ANSWER = { exportedAt: '2026-10-26T09:00:00.000Z', costUnits: [UNIT] };

const SUMMEN = {
  incomeCent: 1000,
  expensesCent: -450,
  balanceCent: 550,
  openIncomeCent: 10,
  openExpensesCent: -20,
  bookings: 2,
};

function rejects(value: unknown): void {
  assert.throws(
    () => readKostenstellenSummen(value),
    (error: unknown) =>
      error instanceof PlaywrightApiError &&
      error.status === 502 &&
      error.message === 'Invalid Kostenstellen-Summen'
  );
}

test('the sums are converted to cents, the balance is recomputed and names are trimmed', () => {
  assert.deepEqual(readKostenstellenSummen({ ...ANSWER, extra: 1 }), {
    loadedAt: '2026-10-26T09:00:00.000Z',
    costUnits: [
      {
        id: 'cun_1',
        name: 'Lager',
        color: '#EAB308',
        archived: false,
        ...SUMMEN,
        years: [2025, 2026],
        yearTotals: [{ year: 2026, ...SUMMEN }],
        categories: [
          {
            id: 'cat_1',
            name: 'Fahrt',
            sphere: 'purpose',
            ...SUMMEN,
            yearTotals: [{ year: 2026, ...SUMMEN }],
          },
        ],
      },
    ],
  });
});

test('color, sphere and archived fall back to their defaults', () => {
  for (const color of ['red', '#12', '#123456789', 5, null, undefined, '#ggg'])
    assert.equal(
      readKostenstellenSummen({ ...ANSWER, costUnits: [{ ...UNIT, color }] }).costUnits[0].color,
      null
    );
  for (const color of ['#abc', '#aBcDeF12'])
    assert.equal(
      readKostenstellenSummen({ ...ANSWER, costUnits: [{ ...UNIT, color }] }).costUnits[0].color,
      color
    );
  for (const archived of ['true', 1, null, undefined, false])
    assert.equal(
      readKostenstellenSummen({ ...ANSWER, costUnits: [{ ...UNIT, archived }] }).costUnits[0]
        .archived,
      false
    );
  assert.equal(
    readKostenstellenSummen({ ...ANSWER, costUnits: [{ ...UNIT, archived: true }] }).costUnits[0]
      .archived,
    true
  );
  for (const sphere of ['ideal', 'purpose', 'assets', 'business'])
    assert.equal(
      readKostenstellenSummen({
        ...ANSWER,
        costUnits: [{ ...UNIT, categories: [{ ...KATEGORIE, sphere }] }],
      }).costUnits[0].categories[0].sphere,
      sphere
    );
  for (const sphere of ['other', 5, null, undefined]) {
    const unit = { ...UNIT, categories: [{ ...KATEGORIE, sphere }] };
    assert.equal(
      readKostenstellenSummen({ ...ANSWER, costUnits: [unit] }).costUnits[0].categories[0].sphere,
      null
    );
  }
});

test('ids may be null but not empty or missing', () => {
  const read = readKostenstellenSummen({
    ...ANSWER,
    costUnits: [{ ...UNIT, id: null, categories: [{ ...KATEGORIE, id: null }] }],
  });
  assert.equal(read.costUnits[0].id, null);
  assert.equal(read.costUnits[0].categories[0].id, null);
  for (const id of ['', 5, undefined]) {
    rejects({ ...ANSWER, costUnits: [{ ...UNIT, id }] });
    rejects({ ...ANSWER, costUnits: [{ ...UNIT, categories: [{ ...KATEGORIE, id }] }] });
  }
});

test('open Kostenstellen come first, each group by name', () => {
  const unit = (name: string, archived: boolean) => ({ ...UNIT, name, archived });
  const read = readKostenstellenSummen({
    ...ANSWER,
    costUnits: [
      unit('b', true),
      unit('Zelt', false),
      unit('Ärger', false),
      unit('a', true),
      unit('äa', false),
    ],
  });
  assert.deepEqual(
    read.costUnits.map((item) => item.name),
    ['äa', 'Ärger', 'Zelt', 'a', 'b']
  );
});

test('the top level of the answer must be complete', () => {
  for (const value of [
    null,
    [],
    'x',
    {},
    { ...ANSWER, exportedAt: 5 },
    { ...ANSWER, exportedAt: 'gestern' },
    { ...ANSWER, costUnits: {} },
  ])
    rejects(value);
  assert.deepEqual(readKostenstellenSummen({ ...ANSWER, costUnits: [] }).costUnits, []);
});

test('missing or malformed sums and years are refused', () => {
  const units = [
    ...[
      null,
      [],
      'x',
      { ...UNIT, name: 5 },
      { ...UNIT, name: undefined },
      { ...UNIT, categories: undefined },
    ],
    ...[
      { ...UNIT, bookings: 1.5 },
      { ...UNIT, bookings: -1 },
      { ...UNIT, bookings: '1' },
    ],
    ...[
      { ...UNIT, income: '1' },
      { ...UNIT, expenses: null },
      { ...UNIT, openIncome: undefined },
    ],
    ...[
      { ...UNIT, openExpenses: Number.NaN },
      { ...UNIT, years: undefined },
      { ...UNIT, years: [2026, '2027'] },
    ],
    ...[
      { ...UNIT, years: [1899] },
      { ...UNIT, years: [10000] },
      { ...UNIT, years: [2026.5] },
    ],
    ...[
      { ...UNIT, yearTotals: undefined },
      { ...UNIT, yearTotals: [null] },
      { ...UNIT, yearTotals: [{ ...YEAR, year: 1800 }] },
    ],
    { ...UNIT, yearTotals: [{ ...YEAR, income: undefined }] },
    { ...UNIT, categories: [null] },
    { ...UNIT, categories: [{ ...KATEGORIE, name: undefined }] },
    { ...UNIT, categories: [{ ...KATEGORIE, yearTotals: undefined }] },
    { ...UNIT, categories: [{ ...KATEGORIE, bookings: undefined }] },
    { ...UNIT, categories: [{ ...KATEGORIE, yearTotals: [{ year: 2026 }] }] },
  ];
  for (const unit of units) rejects({ ...ANSWER, costUnits: [UNIT, unit] });
});

test('years at the limits are accepted', () => {
  const read = readKostenstellenSummen({
    ...ANSWER,
    costUnits: [{ ...UNIT, years: [1900, 9999], yearTotals: [{ ...YEAR, year: 9999 }] }],
  });
  assert.deepEqual(read.costUnits[0].years, [1900, 9999]);
  assert.equal(read.costUnits[0].yearTotals[0].year, 9999);
});
