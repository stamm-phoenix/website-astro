import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  BelegCheckError,
  checkBelegRotation,
  forgetBelegChecks,
  parseStoredBelegCheck,
  toBelegCheck,
} from '../lib/beleg-check';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';

const NOW = new Date('2026-10-01T10:00:00Z');
const ANSWER = {
  isReceipt: true,
  complete: true,
  readable: true,
  issues: [],
  restrictedItems: [],
  shop: 'REWE',
  date: '2026-09-30',
  amount: 12.34,
};
const check = (answer: object) => toBelegCheck({ ...ANSWER, ...answer }, NOW);

test('the model answer is normalised: texts are collapsed, cut and capped', () => {
  const read = check({
    issues: [
      ' a   b\n c ',
      '',
      '   ',
      5,
      null,
      'x'.repeat(250),
      ...Array.from({ length: 12 }, (_, i) => `m${i}`),
    ],
    restrictedItems: [
      ' Bier ',
      {},
      'y'.repeat(150),
      ...Array.from({ length: 30 }, (_, i) => `r${i}`),
    ],
    shop: `  ${'s'.repeat(120)}  `,
  });
  assert.deepEqual(read.issues.slice(0, 2), ['a b c', 'x'.repeat(200)]);
  assert.equal(read.issues.length, 8);
  assert.deepEqual(read.restrictedItems.slice(0, 2), ['Bier', 'y'.repeat(100)]);
  assert.equal(read.restrictedItems.length, 20);
  assert.equal(read.shop, 's'.repeat(100));
});

test('unexpected types in the answer are replaced by the safe default', () => {
  const read = toBelegCheck(
    { isReceipt: 'true', complete: 1, readable: 'yes', issues: 'x', shop: 5 },
    NOW
  );
  assert.deepEqual(read, {
    ok: false,
    isReceipt: false,
    complete: false,
    readable: false,
    issues: [],
    restrictedItems: [],
    shop: null,
    date: null,
    amountCent: null,
    checkedAt: NOW.toISOString(),
  });
  assert.equal(check({ shop: '   ' }).shop, null);
  assert.equal(check({ restrictedItems: 'Bier' }).restrictedItems.length, 0);
  assert.deepEqual(toBelegCheck([], NOW).issues, []);
  assert.equal(toBelegCheck({ ...ANSWER, more: 1 }, NOW).ok, true);
});

test('only a receipt can be complete and readable, and only then restricted items count', () => {
  const read = check({ isReceipt: false, restrictedItems: ['Bier'], issues: ['Kein Beleg.'] });
  assert.deepEqual(
    [read.ok, read.complete, read.readable, read.restrictedItems, read.issues],
    [false, false, false, [], ['Kein Beleg.']]
  );
  const partial = check({ readable: false });
  assert.deepEqual([partial.ok, partial.complete, partial.readable], [false, true, false]);
});

test('date and amount are only kept when they are plausible', () => {
  assert.equal(check({ date: ' 2026-09-30 ' }).date, '2026-09-30');
  for (const date of ['30.9.2026', '2026-9-30', 5, null, undefined, ''])
    assert.equal(check({ date }).date, null);
  // The text is cut to ten characters before it is checked
  assert.equal(check({ date: '2026-09-30T10:00' }).date, '2026-09-30');
  for (const [amount, cent] of [
    [12.34, 1234],
    [0.01, 1],
    [10_000, 1_000_000],
    [0.285, 28],
  ])
    assert.equal(check({ amount }).amountCent, cent);
  for (const amount of [
    0,
    -1,
    10_000.01,
    '12',
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])
    assert.equal(check({ amount }).amountCent, null);
});

test('an answer that is no object is refused', () => {
  for (const raw of [null, undefined, 'x', 5, true])
    assert.throws(() => toBelegCheck(raw, NOW), BelegCheckError);
});

const STORED = {
  ok: true,
  isReceipt: true,
  complete: true,
  readable: false,
  issues: ['a', 5, 'b'],
  restrictedItems: ['c', null],
  shop: 'REWE',
  date: 'irgendwann',
  amountCent: 1234,
  checkedAt: '2026-10-01T10:00:00.000Z',
  extra: 1,
};
const parse = (value: unknown) => parseStoredBelegCheck(JSON.stringify(value));

test('a stored check keeps its values and drops what is not a string', () => {
  assert.deepEqual(parse(STORED), {
    ok: true,
    isReceipt: true,
    complete: true,
    readable: false,
    issues: ['a', 'b'],
    restrictedItems: ['c'],
    shop: 'REWE',
    date: 'irgendwann',
    amountCent: 1234,
    checkedAt: '2026-10-01T10:00:00.000Z',
  });
});

test('an old or sparse stored check is filled with defaults', () => {
  assert.deepEqual(parse({ ok: false, issues: [] }), {
    ok: false,
    isReceipt: false,
    complete: false,
    readable: false,
    issues: [],
    restrictedItems: [],
    shop: null,
    date: null,
    amountCent: null,
    checkedAt: '',
  });
  const odd = parse({
    ok: true,
    issues: [],
    isReceipt: 'true',
    complete: 1,
    readable: null,
    restrictedItems: 'x',
    shop: 5,
    date: 5,
    amountCent: '5',
    checkedAt: 5,
  });
  assert.deepEqual(odd, {
    ok: true,
    isReceipt: false,
    complete: false,
    readable: false,
    issues: [],
    restrictedItems: [],
    shop: null,
    date: null,
    amountCent: null,
    checkedAt: '',
  });
});

test('a stored check that cannot be read yields null', () => {
  for (const value of [undefined, '', 'nonsense', '{', 'null', '5', '"x"', '[]', '{}'])
    assert.equal(parseStoredBelegCheck(value), null);
  for (const value of [
    { ...STORED, ok: 'true' },
    { ...STORED, ok: undefined },
    { ...STORED, issues: 'x' },
    { ...STORED, issues: undefined },
    { ...STORED, issues: null },
  ])
    assert.equal(parse(value), null);
});

function withModel(t: TestContext, answer: unknown): void {
  overrideConfig(t, CONFIG.belege.check, {
    endpoint: 'https://example.openai.azure.com',
    deployment: 'test-deployment',
    maxChecksPerDay: 1000,
  });
  forgetBelegChecks();
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  });
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }))
  );
}

test('the rotation is one of the four right angles, otherwise 0', async (t) => {
  for (const [rotation, expected] of [
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [45, 0],
    ['90', 0],
    [null, 0],
    [undefined, 0],
    [360, 0],
  ]) {
    withModel(t, { rotation });
    assert.equal(await checkBelegRotation(new Uint8Array([1])), expected);
  }
  withModel(t, { other: 1 });
  assert.equal(await checkBelegRotation(new Uint8Array([1])), 0);
});

test('an answer without object is refused for the rotation as well', async (t) => {
  for (const answer of [null, 'x', 5]) {
    withModel(t, answer);
    await assert.rejects(checkBelegRotation(new Uint8Array([1])), BelegCheckError);
  }
});
