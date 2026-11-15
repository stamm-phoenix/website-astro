import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVerleih, validateVerleihAktion } from '../lib/validation/verleih';
import { ValidationError } from '../lib/validation/errors';
const valid = {
  entleiher: 'Rover',
  von: '2026-12-01',
  bis: '2026-12-03',
  positionen: [{ varianteId: 1, menge: 2 }],
};
test('optional contact and responsible person never block a request', () => {
  const value = validateVerleih(valid);
  assert.equal(value.kontakt, '');
  assert.equal(value.verantwortlich, '');
});
test('invalid dates, fractional quantities, duplicates and reversed ranges have German field errors', () => {
  for (const [change, key] of [
    [{ von: '2026-02-30' }, 'von'],
    [{ bis: '2026-11-30' }, 'bis'],
    [{ positionen: [{ varianteId: 1, menge: 1.5 }] }, 'positionen'],
    [
      {
        positionen: [
          { varianteId: 1, menge: 1 },
          { varianteId: 1, menge: 2 },
        ],
      },
      'positionen',
    ],
  ] as const) {
    assert.throws(
      () => validateVerleih({ ...valid, ...change }),
      (e: unknown) =>
        e instanceof ValidationError && !!e.fields[key] && !e.fields[key].includes('Invalid')
    );
  }
});
test('a return needs positive quantities and unique positions', () => {
  assert.throws(
    () => validateVerleihAktion({ aktion: 'rueckgabe', rueckgaben: [] }),
    ValidationError
  );
  assert.throws(
    () =>
      validateVerleihAktion({
        aktion: 'rueckgabe',
        rueckgaben: [
          { positionId: 1, menge: 1 },
          { positionId: 1, menge: 1 },
        ],
      }),
    ValidationError
  );
});
