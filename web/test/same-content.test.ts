import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameContent } from '../src/lib/sameContent';

test('equal lists of nested objects are the same, wherever they come from', () => {
  const a = [{ id: 'a', tags: ['x', 'y'], image: { src: '/a.webp', width: 3 } }];
  const b = JSON.parse(JSON.stringify(a)) as typeof a;
  assert.equal(sameContent(a, b), true);
});

test('a changed value, a missing item or a different order is a difference', () => {
  const a = [
    { id: 'a', title: 'Lager' },
    { id: 'b', title: 'Wanderung' },
  ];
  const changed = [
    { id: 'a', title: 'Lager' },
    { id: 'b', title: 'Wandern' },
  ];
  assert.equal(sameContent(a, changed), false);
  assert.equal(sameContent(a, [a[0]]), false);
  assert.equal(sameContent(a, [a[1], a[0]]), false);
});

test('a key with the value undefined counts as missing, the order of keys does not matter', () => {
  assert.equal(sameContent({ id: 'a', note: undefined }, { id: 'a' }), true);
  assert.equal(sameContent({ id: 'a', title: 'x' }, { title: 'x', id: 'a' }), true);
  assert.equal(sameContent({ id: 'a', note: null }, { id: 'a' }), false);
});

test('null, empty list and empty object are different from each other', () => {
  assert.equal(sameContent(null, []), false);
  assert.equal(sameContent([], {}), false);
  assert.equal(sameContent(null, null), true);
});
