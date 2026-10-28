import assert from 'node:assert/strict';
import test from 'node:test';
import { readAktionBeitraege, readBeitraege } from '../lib/beitraege';
import { PlaywrightApiError } from '../lib/playwright-api';

const BATCH = {
  id: 'bat_1',
  name: 'Lager',
  type: 'event',
  eventId: 'evt_1',
  feeCount: 2,
  settledCount: 1,
  totalAmount: 175.5,
  openAmount: 75.5,
  refundAmount: 0,
};

const FEE = {
  id: 'fee_1',
  reference: 'AB1',
  description: 'Beitrag',
  batch: { id: 'bat_1', name: 'Lager', extra: 1 },
  costUnit: { id: 'cun_1', name: 'Lager', color: '#eab308' },
  category: { id: 'cat_1', name: 'Teilnehmerbeiträge' },
  payer: 'Kim',
  payerId: 'per_1',
  paymentMethod: 'bank_transfer',
  date: '2026-03-21',
  amount: 75.5,
  dueAmount: 75.5,
  paidAmount: 0.1,
  openAmount: 75.4,
  status: 'partial',
  paidAt: '2026-04-01',
};

const ANSWER = { loadedAt: '2026-10-19T12:00:00.000Z', batches: [BATCH], fees: [FEE] };

function rejects(read: (value: unknown) => unknown, value: unknown): void {
  assert.throws(
    () => read(value),
    (error: unknown) =>
      error instanceof PlaywrightApiError &&
      error.status === 502 &&
      error.message === 'Invalid Beiträge'
  );
}

test('a complete answer is converted to cents and unknown fields are dropped', () => {
  assert.deepEqual(readBeitraege({ ...ANSWER, more: true }), {
    loadedAt: '2026-10-19T12:00:00.000Z',
    batches: [
      {
        id: 'bat_1',
        name: 'Lager',
        type: 'event',
        eventId: 'evt_1',
        feeCount: 2,
        settledCount: 1,
        totalCent: 17550,
        openCent: 7550,
        refundCent: 0,
      },
    ],
    fees: [
      {
        id: 'fee_1',
        reference: 'AB1',
        description: 'Beitrag',
        amountCent: 7550,
        dueCent: 7550,
        paidCent: 10,
        openCent: 7540,
        status: 'partial',
        batchId: 'bat_1',
        costUnit: { id: 'cun_1', name: 'Lager' },
        category: 'Teilnehmerbeiträge',
        payer: 'Kim',
        payerId: 'per_1',
        paymentMethod: 'bank_transfer',
        date: '2026-03-21',
        paidAt: '2026-04-01',
      },
    ],
  });
});

test('cents are rounded like the old reader', () => {
  const fee = { ...FEE, amount: 0.285, dueAmount: -1.005, paidAmount: 19.999, openAmount: 1e-9 };
  const [read] = readBeitraege({ ...ANSWER, fees: [fee] }).fees;
  assert.deepEqual(
    [read.amountCent, read.dueCent, read.paidCent, read.openCent],
    [28, -100, 2000, 0]
  );
});

test('optional texts of a Sammlung and a Beitrag fall back to defaults', () => {
  const batch = { id: 'bat_2', feeCount: 0, settledCount: 0 };
  const money = { totalAmount: 0, openAmount: 0, refundAmount: 0 };
  const fee = {
    id: 'fee_2',
    amount: 1,
    dueAmount: 1,
    paidAmount: 0,
    openAmount: 1,
    status: 'unpaid',
  };
  const read = readBeitraege({
    loadedAt: '2026-10-19',
    batches: [{ ...batch, ...money, name: 5, type: null, eventId: '' }],
    fees: [
      {
        ...fee,
        reference: 7,
        description: [],
        payer: {},
        payerId: '',
        paymentMethod: 3,
        date: '21.03.2026',
        paidAt: '2026-4-1',
        category: null,
      },
      { ...fee, batch: null, costUnit: undefined },
    ],
  });
  assert.deepEqual(read.batches[0], {
    id: 'bat_2',
    name: '',
    type: '',
    eventId: null,
    feeCount: 0,
    settledCount: 0,
    totalCent: 0,
    openCent: 0,
    refundCent: 0,
  });
  for (const beitrag of read.fees) {
    assert.deepEqual(
      [
        beitrag.reference,
        beitrag.description,
        beitrag.payer,
        beitrag.payerId,
        beitrag.paymentMethod,
        beitrag.date,
        beitrag.paidAt,
        beitrag.batchId,
        beitrag.costUnit,
        beitrag.category,
      ],
      ['', '', '', null, null, '', null, null, null, null]
    );
  }
});

test('the top level of the answer must be complete', () => {
  for (const value of [
    null,
    [],
    'x',
    {},
    { ...ANSWER, loadedAt: 5 },
    { ...ANSWER, loadedAt: 'gestern' },
    { ...ANSWER, batches: {} },
    { ...ANSWER, fees: undefined },
  ])
    rejects(readBeitraege, value);
  assert.deepEqual(readBeitraege({ ...ANSWER, batches: [], fees: [] }).fees, []);
});

test('one broken entry refuses the whole answer', () => {
  const bad = [
    ...[null, [], 'x', { ...BATCH, id: 5 }, { ...BATCH, id: undefined }],
    ...[
      { ...BATCH, feeCount: 1.5 },
      { ...BATCH, feeCount: -1 },
      { ...BATCH, settledCount: '1' },
    ],
    ...[
      { ...BATCH, totalAmount: '1' },
      { ...BATCH, openAmount: null },
      { ...BATCH, refundAmount: undefined },
    ],
  ];
  for (const batch of bad) rejects(readBeitraege, { ...ANSWER, batches: [BATCH, batch] });
  const fees = [
    ...[
      null,
      [],
      'x',
      { ...FEE, id: 1 },
      { ...FEE, status: 'unknown' },
      { ...FEE, status: undefined },
    ],
    ...[
      { ...FEE, amount: '1' },
      { ...FEE, dueAmount: null },
      { ...FEE, paidAmount: undefined },
    ],
    ...[
      { ...FEE, openAmount: Number.NaN },
      { ...FEE, batch: {} },
      { ...FEE, batch: 'bat_1' },
    ],
    ...[
      { ...FEE, costUnit: { id: 'x' } },
      { ...FEE, category: { name: 'x' } },
      { ...FEE, category: [] },
    ],
  ];
  for (const fee of fees) rejects(readBeitraege, { ...ANSWER, fees: [FEE, fee] });
});

test('every status of CampFlow is accepted', () => {
  for (const status of ['paid', 'unpaid', 'partial', 'refund', 'cancelled'])
    assert.equal(readBeitraege({ ...ANSWER, fees: [{ ...FEE, status }] }).fees[0].status, status);
});

const PERSONS = {
  eventId: 'evt_1',
  loadedAt: '2026-10-19T12:00:00.000Z',
  persons: [
    { id: 'per_a', fees: [FEE, { ...FEE, id: 'fee_2', status: 'paid' }] },
    { id: 'per_b', fees: [] },
    { id: 'per_a', fees: [{ ...FEE, id: 'fee_3' }] },
  ],
};

test('the Beiträge of an Aktion are collected per person and keep only the shared fields', () => {
  const read = readAktionBeitraege({ ...PERSONS, extra: 1 });
  assert.equal(read.eventId, 'evt_1');
  assert.equal(read.loadedAt, '2026-10-19T12:00:00.000Z');
  assert.deepEqual(Object.keys(read.persons), ['per_a', 'per_b']);
  assert.deepEqual(
    read.persons.per_a.map((fee) => fee.id),
    ['fee_1', 'fee_2', 'fee_3']
  );
  assert.deepEqual(read.persons.per_b, []);
  assert.deepEqual(read.persons.per_a[0], {
    id: 'fee_1',
    reference: 'AB1',
    description: 'Beitrag',
    amountCent: 7550,
    dueCent: 7550,
    paidCent: 10,
    openCent: 7540,
    status: 'partial',
  });
});

test('an answer for the participants of an Aktion must be complete and have valid person IDs', () => {
  const bad = [
    ...[null, [], {}, { ...PERSONS, eventId: 1 }, { ...PERSONS, loadedAt: 'x' }],
    ...[
      { ...PERSONS, persons: {} },
      { ...PERSONS, persons: [null] },
      { ...PERSONS, persons: [{ fees: [] }] },
    ],
    ...[
      { ...PERSONS, persons: [{ id: '__proto__', fees: [] }] },
      { ...PERSONS, persons: [{ id: 'per_', fees: [] }] },
    ],
    ...[
      { ...PERSONS, persons: [{ id: 'per_a-b', fees: [] }] },
      { ...PERSONS, persons: [{ id: 'per_a' }] },
    ],
    { ...PERSONS, persons: [{ id: 'per_a', fees: [{ ...FEE, status: 'x' }] }] },
    { ...PERSONS, persons: [{ id: 'per_a', fees: [null] }] },
  ];
  for (const value of bad) rejects(readAktionBeitraege, value);
  assert.deepEqual(readAktionBeitraege({ ...PERSONS, persons: [] }).persons, {});
});
