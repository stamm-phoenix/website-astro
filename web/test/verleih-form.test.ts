import test from 'node:test';
import assert from 'node:assert/strict';
import { leseVerleihEntwurf } from '../src/lib/verleihForm';
test('restoring a request keeps its identity and every added material, including an empty quantity', () => {
  const anfrageId = '864f033a-0a25-417c-91d9-6c8c5c5e1594';
  const value = leseVerleihEntwurf(
    JSON.stringify({ anfrageId, positionen: [{ varianteId: 1, menge: 2 }, { varianteId: 3 }] })
  );
  assert.deepEqual(value, {
    anfrageId,
    positionen: [
      { varianteId: 1, menge: 2 },
      { varianteId: 3, menge: undefined },
    ],
  });
});
test('invalid rescued data is retained for manual recovery instead of applied to another request', () => {
  for (const text of [
    'null',
    '{}',
    'broken',
    JSON.stringify({ anfrageId: 'wrong', positionen: [] }),
  ])
    assert.equal(leseVerleihEntwurf(text), null);
});
