import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readCampflowBelege } from '../lib/campflow-belege';
import * as db from '../lib/db';
import * as env from '../lib/environment';
import {
  ensureCampflowExpenseAssignment,
  getKostenstellen,
  PlaywrightApiError,
  uploadCampflowBeleg,
} from '../lib/playwright-api';

const BELEG = {
  id: 'exp_1',
  number: ' 2026-94 ',
  status: 'settled',
  description: 'Zelt',
  date: '2026-10-01',
  amountEur: -12.34,
  openAmountEur: -0.1,
  paidBy: ' Kim Beispiel ',
  costUnits: [{ id: 'cun_1', name: 'Lager', color: '#fff' }],
  categories: [{ id: 'cat_1', name: 'Fahrt', costUnitId: 'cun_1', sphere: 'ideal' }],
  pages: 2.7,
  originalFilename: 'scan.pdf',
  uploadedAt: '2026-10-01 10:00:00',
  settledAt: '2026-10-02',
};
const ANSWER = {
  loadedAt: '2026-10-19T12:00:00.000Z',
  costUnits: [
    { id: 'cun_1', name: 'Lager', archived: true, categories: [{ id: 'cat_1', name: 'Fahrt' }] },
  ],
  receipts: [BELEG],
};

/** Replaces the database by one that knows the given transfers of the Belege module. */
function mockTransfers(
  t: TestContext,
  rows: { campflow_expense_id: string | null; submitted_by: string }[] = []
): void {
  const query = { select: () => query, where: () => query, execute: async () => rows };
  t.mock.method(db, 'getDb', () => ({ selectFrom: () => query }));
}

function rejects(value: unknown): Promise<void> {
  return assert.rejects(
    readCampflowBelege(value, 'kim@example.test'),
    (error: unknown) =>
      error instanceof PlaywrightApiError &&
      error.status === 502 &&
      error.message === 'Invalid CampFlow-Belege'
  );
}

test('a complete answer of the receipts is converted to cents', async (t) => {
  mockTransfers(t, [
    { campflow_expense_id: 'exp_1', submitted_by: 'KIM@example.test' },
    { campflow_expense_id: null, submitted_by: 'x' },
  ]);
  const read = await readCampflowBelege({ ...ANSWER, more: 1 }, 'kim@example.test', [
    'Kim Beispiel',
  ]);
  assert.deepEqual(read, {
    loadedAt: '2026-10-19T12:00:00.000Z',
    costUnits: [
      { id: 'cun_1', name: 'Lager', archived: true, categories: [{ id: 'cat_1', name: 'Fahrt' }] },
    ],
    belege: [
      {
        id: 'exp_1',
        number: '2026-94',
        status: 'settled',
        description: 'Zelt',
        date: '2026-10-01',
        amountCent: -1234,
        openCent: -10,
        paidBy: 'Kim Beispiel',
        costUnits: [{ id: 'cun_1', name: 'Lager' }],
        categories: [{ id: 'cat_1', name: 'Fahrt', costUnitId: 'cun_1' }],
        pages: 2,
        fileName: null,
        uploadedAt: '2026-10-01 10:00:00',
        settledAt: '2026-10-02',
        viaWebsite: true,
        submittedByMe: true,
        mine: true,
      },
    ],
  });
});

test('optional fields of a receipt fall back to defaults', async (t) => {
  mockTransfers(t);
  const sparse = {
    id: 'rcp_1',
    status: 'unbooked',
    amountEur: 1,
    openAmountEur: 1,
    costUnits: [],
    categories: [],
  };
  const read = await readCampflowBelege(
    {
      ...ANSWER,
      costUnits: [{ id: 'cun_2', categories: [{ id: 'cat_9' }] }],
      receipts: [
        sparse,
        {
          ...sparse,
          id: 'rcp_2',
          originalFilename: ' scan.png ',
          settledAt: '2026-10-02',
          number: '  ',
          paidBy: 5,
        },
        { ...BELEG, status: 'open', originalFilename: 'x.pdf', settledAt: '2026-10-02' },
        { ...BELEG, id: 'exp_3', pages: 0.5, date: 'heute', settledAt: 'gestern', uploadedAt: ' ' },
        {
          ...BELEG,
          id: 'exp_4',
          pages: '3',
          categories: [{ id: 'cat_2', name: 7, costUnitId: 5 }],
        },
      ],
    },
    'kim@example.test'
  );
  assert.deepEqual(read.costUnits, [
    { id: 'cun_2', name: '', archived: false, categories: [{ id: 'cat_9', name: '' }] },
  ]);
  const [first, second, open, third, fourth] = read.belege;
  assert.deepEqual(first, {
    id: 'rcp_1',
    number: null,
    status: 'unbooked',
    description: '',
    date: null,
    amountCent: 100,
    openCent: 100,
    paidBy: null,
    costUnits: [],
    categories: [],
    pages: 1,
    fileName: null,
    uploadedAt: null,
    settledAt: null,
    viaWebsite: false,
    submittedByMe: false,
    mine: false,
  });
  // The file name only counts for unbooked receipts, the settlement day only for settled ones
  assert.deepEqual(
    [second.fileName, second.number, second.paidBy, second.settledAt],
    ['scan.png', null, null, null]
  );
  assert.deepEqual([open.fileName, open.settledAt], [null, null]);
  assert.deepEqual(
    [third.pages, third.date, third.settledAt, third.uploadedAt],
    [1, null, null, null]
  );
  assert.deepEqual(fourth.categories, [{ id: 'cat_2', name: '', costUnitId: null }]);
  assert.equal(fourth.pages, 1);
});

test('the status of a receipt is one of the three CampFlow states', async (t) => {
  mockTransfers(t);
  for (const status of ['unbooked', 'open', 'settled']) {
    const read = await readCampflowBelege({ ...ANSWER, receipts: [{ ...BELEG, status }] }, 'x');
    assert.equal(read.belege[0].status, status);
  }
});

test('the answer is refused before the database is asked', async (t) => {
  const getDb = t.mock.method(db, 'getDb', () => {
    throw new Error('database must not be reached');
  });
  const receipt = (extra: object) => ({ ...ANSWER, receipts: [{ ...BELEG, ...extra }] });
  const bad = [
    ...[null, [], 'x', {}, { ...ANSWER, loadedAt: 5 }, { ...ANSWER, loadedAt: 'gestern' }],
    ...[
      { ...ANSWER, receipts: undefined },
      { ...ANSWER, receipts: {} },
    ],
    ...[
      { ...ANSWER, costUnits: undefined },
      { ...ANSWER, costUnits: [null] },
    ],
    ...[{ ...ANSWER, costUnits: [{ name: 'x', categories: [] }] }],
    ...[{ ...ANSWER, costUnits: [{ id: 'cun_1' }] }],
    ...[{ ...ANSWER, costUnits: [{ id: 'cun_1', categories: [{ name: 'x' }] }] }],
    ...[
      { ...ANSWER, receipts: [null] },
      { ...ANSWER, receipts: [[]] },
    ],
    ...[receipt({ id: 1 }), receipt({ status: 'paid' }), receipt({ status: undefined })],
    ...[receipt({ amountEur: '1' }), receipt({ openAmountEur: null })],
    ...[receipt({ costUnits: undefined }), receipt({ costUnits: [{ name: 'x' }] })],
    ...[receipt({ categories: undefined }), receipt({ categories: [null] })],
    receipt({ categories: [{ name: 'x' }] }),
  ];
  for (const value of bad) await rejects(value);
  assert.equal(getDb.mock.callCount(), 0);
});

const UNIT = {
  id: 'cun_Test',
  name: 'Lager',
  archived: false,
  categories: [{ name: 'Fahrt', sphere: 'ideal' }],
};

function mockFetch(t: TestContext, body: unknown, status = 200): void {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
}

function assignment(): Promise<void> {
  return ensureCampflowExpenseAssignment('Lager', 'Fahrt', 'ideal');
}

const isError =
  (message: string, status = 502) =>
  (error: unknown) =>
    error instanceof PlaywrightApiError && error.status === status && error.message === message;

test('cost centres of CampFlow are validated before a booking relies on them', async (t) => {
  mockFetch(t, { data: [UNIT] });
  await assignment();
  const bad = [
    null,
    [],
    'x',
    { ...UNIT, id: 'xyz' },
    { ...UNIT, id: 5 },
    { ...UNIT, name: '  ' },
    { ...UNIT, name: 5 },
    { ...UNIT, archived: 'false' },
    { ...UNIT, archived: undefined },
    { ...UNIT, categories: {} },
    { ...UNIT, categories: [null] },
    { ...UNIT, categories: [{ sphere: 'ideal' }] },
    { ...UNIT, categories: [{ name: 'Fahrt', sphere: 'other' }] },
    { ...UNIT, categories: [{ name: 'Fahrt' }] },
  ];
  for (const unit of bad) {
    mockFetch(t, { data: [UNIT, unit] });
    await assert.rejects(assignment(), isError('Invalid cost centre'));
  }
});

test('a cost centre list without data is refused', async (t) => {
  for (const body of [{}, { data: {} }, null, [], 'x']) {
    mockFetch(t, body);
    await assert.rejects(assignment(), isError('Invalid cost centre list'));
  }
});

test('the list of Kostenstellen keeps only valid Kategorien and reads archived leniently', async (t) => {
  mockFetch(t, {
    data: [
      {
        id: 'cun_1',
        name: 'A',
        archived: true,
        extra: 1,
        categories: [
          { id: 'cat_1', name: 'x', sphere: 'ideal' },
          { id: 'cat_2' },
          { name: 'y' },
          null,
          5,
          'z',
          [],
          { id: 1, name: 'n' },
        ],
      },
      { id: 'cun_2', name: 'B', archived: 'true', categories: {} },
      { id: 'cun_3', name: 'C' },
    ],
  });
  assert.deepEqual(await getKostenstellen(), [
    { id: 'cun_1', name: 'A', archived: true, categories: [{ id: 'cat_1', name: 'x' }] },
    { id: 'cun_2', name: 'B', archived: false, categories: [] },
    { id: 'cun_3', name: 'C', archived: false, categories: [] },
  ]);
});

const UPLOAD = {
  filename: 'a.jpg',
  content: new Uint8Array([1]),
  description: 'x',
  date: '2026-10-01',
  amountCent: 100,
  disburser: null,
  costUnit: 'cun_1',
  category: 'cat_1',
};

test('the answer of an upload needs a number and the created flag', async (t) => {
  mockFetch(t, { created: true, number: '2026-1', receiptId: 'rcp_1', expenseId: 'exp_1', x: 1 });
  assert.deepEqual(await uploadCampflowBeleg(UPLOAD), {
    created: true,
    number: '2026-1',
    receiptId: 'rcp_1',
    expenseId: 'exp_1',
  });
  mockFetch(t, { created: false, number: '2026-1', receiptId: 5 });
  assert.deepEqual(await uploadCampflowBeleg(UPLOAD), {
    created: false,
    number: '2026-1',
    receiptId: '',
    expenseId: '',
  });
  const bad: unknown[] = [null, [], 'x', {}, { created: true }, { number: '1' }];
  bad.push(
    { created: true, number: '' },
    { created: 'true', number: '1' },
    { created: true, number: 1 }
  );
  for (const body of bad) {
    mockFetch(t, body);
    await assert.rejects(uploadCampflowBeleg(UPLOAD), isError('Invalid receipt upload response'));
  }
});

test('the explanation of a failed response is read only from a string `error`', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  const cases: [unknown, string][] = [
    [{ error: 'Kategorie fehlt' }, 'Kategorie fehlt'],
    [{ error: 'x'.repeat(600) }, 'x'.repeat(500)],
    [{ error: 5 }, ''],
    [[], ''],
    [null, ''],
    ['text', ''],
  ];
  for (const [body, detail] of cases) {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify(body), { status: 500 })
    );
    await assert.rejects(
      uploadCampflowBeleg(UPLOAD),
      (error: unknown) =>
        error instanceof PlaywrightApiError && error.status === 500 && error.detail === detail
    );
  }
});
