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
test('assigns German server errors to the corresponding exception inputs', () => {
  const cases = [
    {
      patch: { startDate: '2026-02-30' },
      fields: { exceptionStartDate: 'Bitte ein gültiges Datum angeben.' },
    },
    {
      patch: { endDate: '2026-11-01' },
      fields: { exceptionEndDate: 'Das Ende darf nicht vor dem Beginn liegen.' },
    },
    { patch: { message: ' ' }, fields: { exceptionMessage: 'Bitte eine Nachricht angeben.' } },
    {
      patch: { location: 'x'.repeat(121) },
      fields: { exceptionLocation: 'den anderen Treffpunkt darf höchstens 120 Zeichen lang sein.' },
    },
    {
      patch: { time: 'x'.repeat(61) },
      fields: { exceptionTime: 'die andere Uhrzeit darf höchstens 60 Zeichen lang sein.' },
    },
  ];
  for (const { patch, fields } of cases) {
    assert.throws(
      () =>
        validateGruppenstunde({ ...regular, exception: { ...exception, ...patch } }, ['Wölflinge']),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.deepEqual(error.fields, fields);
        return true;
      }
    );
  }
});
test('keeps whole-object and regular field errors on their original keys', () => {
  assert.throws(
    () => validateGruppenstunde({ ...regular, location: '', exception: false }, ['Wölflinge']),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.fields, {
        location: 'Bitte den Ort angeben.',
        exception: 'Bitte eine gültige Änderung angeben.',
      });
      return true;
    }
  );
});
test('accepts removal and old clients without an exception', () => {
  assert.equal(
    validateGruppenstunde({ ...regular, exception: null }, ['Wölflinge']).exception,
    null
  );
  assert.equal(validateGruppenstunde(regular, ['Wölflinge']).exception, undefined);
});
