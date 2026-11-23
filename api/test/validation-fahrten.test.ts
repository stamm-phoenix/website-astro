import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import { MAX_FAHRTEN_NACHRICHT, validateFahrtenMail } from '../lib/validation/fahrten';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('a plan is read with trimmed ids, a kept note and a missing direction as no cars', () => {
  assert.deepEqual(
    validateFahrtenMail({
      fahrten: { hin: [{ fahrer: ' per_1 ', mitfahrende: ['per_2'] }] },
      nachricht: '  Treffpunkt 9 Uhr\nam Pfarrheim  ',
    }),
    {
      fahrten: { hin: [{ fahrer: 'per_1', mitfahrende: ['per_2'] }], rueck: [] },
      nachricht: 'Treffpunkt 9 Uhr\nam Pfarrheim',
    }
  );
});

test('a plan without drivers is refused with a German message', () => {
  assert.deepEqual(
    fields(() => validateFahrtenMail({ fahrten: { hin: [], rueck: [] } })),
    { form: 'Im Plan fährt niemand. Es gibt niemanden zu informieren.' }
  );
  assert.deepEqual(
    fields(() => validateFahrtenMail(null)),
    {
      form: 'Im Plan fährt niemand. Es gibt niemanden zu informieren.',
    }
  );
});

test('broken cars and a long note report on their fields', () => {
  assert.deepEqual(
    fields(() => validateFahrtenMail({ fahrten: { hin: [{ fahrer: '', mitfahrende: [] }] } })),
    { fahrten: 'Eine Person im Plan ist ungültig. Bitte lade die Seite neu.' }
  );
  assert.deepEqual(
    fields(() => validateFahrtenMail({ fahrten: { rueck: 'x' } })),
    {
      fahrten: 'Der Plan ist ungültig. Bitte lade die Seite neu.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateFahrtenMail({
        fahrten: { hin: [{ fahrer: 'per_1', mitfahrende: [] }] },
        nachricht: 'x'.repeat(MAX_FAHRTEN_NACHRICHT + 1),
      })
    ),
    { nachricht: `Die Nachricht darf höchstens ${MAX_FAHRTEN_NACHRICHT} Zeichen lang sein.` }
  );
});
