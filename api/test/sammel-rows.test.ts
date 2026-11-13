import assert from 'node:assert/strict';
import test from 'node:test';
import { groupBy } from '../lib/sammelbestellung-rows';

test('groupBy keeps the order of the rows within each key', () => {
  const rows = [
    { order_id: 2, n: 1 },
    { order_id: 1, n: 2 },
    { order_id: 2, n: 3 },
    { order_id: 2, n: 4 },
  ];
  const groups = groupBy(rows, 'order_id');
  assert.deepEqual(
    groups.get(2)?.map((row) => row.n),
    [1, 3, 4]
  );
  assert.deepEqual(
    groups.get(1)?.map((row) => row.n),
    [2]
  );
  assert.equal(groups.get(3), undefined);
});
