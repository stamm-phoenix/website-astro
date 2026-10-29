import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBookingTags, validateHelper } from '../lib/validation/nikolaus-helfende';
import { ValidationError } from '../lib/validation/errors';

function fieldError(action: () => unknown, field: string): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    return error.fields[field];
  }
  assert.fail('Expected a field validation error');
}

test('family characteristic limits name the field and explain the correction', () => {
  const tooLong = fieldError(() => validateBookingTags({ tags: ['x'.repeat(41)] }), 'tags');
  assert.match(tooLong, /Merkmale für die Einteilung/);
  assert.match(tooLong, /Kürze.*40 Zeichen/);
  const tooMany = fieldError(
    () => validateBookingTags({ tags: Array.from({ length: 11 }, (_, i) => `Merkmal ${i}`) }),
    'tags'
  );
  assert.match(tooMany, /10 Merkmale/);
  assert.match(tooMany, /Entferne/);
});

test('contradictory helper preferences name both visible fields and offer a correction', () => {
  const message = fieldError(
    () =>
      validateHelper(
        { name: 'Testperson', positiveTags: [' Wölflinge '], negativeTags: ['wölflinge'] },
        []
      ),
    'negativeTags'
  );
  assert.match(message, /Bevorzugt zu Familien mit/);
  assert.match(message, /Nicht zu Familien mit/);
  assert.match(message, /Entferne.*einem der beiden Felder/);
});
