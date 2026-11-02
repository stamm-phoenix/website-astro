import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGruppenstunde } from '../lib/validation/content';
import { ValidationError } from '../lib/validation/errors';
const regular = { stufe: 'Wölflinge', weekday: 'Montags', time: '18 Uhr', location: 'Heim' };
const exception = {
  startDate: '2026-11-02',
  endDate: '2026-11-08',
  message: 'Entfällt diese Woche',
  location: '',
  time: '',
};
test('keeps a temporary notice without changing regular meeting details', () => {
  const result = validateGruppenstunde({ ...regular, exception }, ['Wölflinge']);
  assert.deepEqual(result.exception, exception);
  assert.equal(result.time, '18 Uhr');
});
test('rejects impossible dates, reversed ranges and blank messages with German field errors', () => {
  for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2026-11-01' }, { message: ' ' }]) {
    assert.throws(
      () =>
        validateGruppenstunde({ ...regular, exception: { ...exception, ...patch } }, ['Wölflinge']),
      (error: unknown) =>
        error instanceof ValidationError &&
        !!error.fields.exception &&
        !error.fields.exception.includes('Invalid')
    );
  }
});
test('accepts removal and old clients without an exception', () => {
  assert.equal(
    validateGruppenstunde({ ...regular, exception: null }, ['Wölflinge']).exception,
    null
  );
  assert.equal(validateGruppenstunde(regular, ['Wölflinge']).exception, undefined);
});
