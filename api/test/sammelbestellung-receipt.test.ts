import assert from 'node:assert/strict';
import test from 'node:test';
import { sammelReceipt } from '../lib/sammelbestellung-export';

const ITEM = { name: 'Kluft', reference: '00123', variant: '164', quantity: 2 };

test('receipt calculations preserve cents, quantities, zero prices and incomplete totals', () => {
  const items = [
    { ...ITEM, reference: ' tent ', quantity: 3 },
    { ...ITEM, reference: 'shirt', quantity: 2 },
    { ...ITEM, reference: 'free', quantity: 1 },
  ];
  assert.deepEqual(sammelReceipt(items, { tent: 100200, shirt: 4995, free: 0 }), {
    subtotalCents: 310590,
    missingPositions: 0,
    totalCents: 310590,
  });
  assert.deepEqual(sammelReceipt(items, { tent: 100200, shirt: null, free: 0 }), {
    subtotalCents: 300600,
    missingPositions: 1,
    totalCents: null,
  });
  assert.equal(sammelReceipt(items, { tent: NaN, shirt: -1 }).missingPositions, 3);
  assert.deepEqual(sammelReceipt([], {}), { subtotalCents: 0, missingPositions: 0, totalCents: 0 });
});
