import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAbhaken } from '../lib/essen-kochen-validation';
import { ValidationError } from '../lib/validation/errors';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  assert.fail('expected a ValidationError');
}

test('a cooked dish keeps what it used, summed per ingredient and unit, 0 for unused', () => {
  assert.deepEqual(
    validateAbhaken({
      status: 'gekocht',
      verbrauch: [
        { planungZutatId: 1, menge: 1.5, einheit: 'kg' },
        { planungZutatId: 1, menge: 0.25, einheit: 'kg' },
        { planungZutatId: 1, menge: 200, einheit: 'g' },
        { planungZutatId: 2, menge: 0, einheit: 'stueck' },
        { planungZutatId: 3, menge: 0.0001, einheit: 'l' },
      ],
    }),
    {
      status: 'gekocht',
      verbrauch: [
        { planungZutatId: 1, menge: 1.75, einheit: 'kg' },
        { planungZutatId: 1, menge: 200, einheit: 'g' },
        { planungZutatId: 2, menge: 0, einheit: 'stueck' },
        { planungZutatId: 3, menge: 0.001, einheit: 'l' },
      ],
    }
  );
});

test('a dish left out or open again uses nothing', () => {
  for (const status of ['ausgelassen', 'offen'] as const) {
    assert.deepEqual(
      validateAbhaken({ status, verbrauch: [{ planungZutatId: 1, menge: 2, einheit: 'kg' }] }),
      { status, verbrauch: [] }
    );
  }
  assert.deepEqual(validateAbhaken({ status: 'gekocht' }), { status: 'gekocht', verbrauch: [] });
});

test('wrong status, amounts and units are refused', () => {
  assert.deepEqual(
    fields(() => validateAbhaken({ status: 'gegessen' })),
    { status: 'Bitte gekocht, ausgelassen oder offen wählen.' }
  );
  const falsch = (eintrag: object) =>
    fields(() => validateAbhaken({ status: 'gekocht', verbrauch: [eintrag] })).verbrauch;
  assert.equal(
    falsch({ planungZutatId: 1, menge: -1, einheit: 'g' }),
    'Bitte eine Menge ab 0 eintragen, z. B. 2,5.'
  );
  assert.equal(
    falsch({ planungZutatId: 1, menge: '2', einheit: 'g' }),
    'Bitte eine Menge ab 0 eintragen, z. B. 2,5.'
  );
  assert.equal(
    falsch({ planungZutatId: 1, menge: 2_000_000, einheit: 'g' }),
    'Die Menge ist zu groß.'
  );
  assert.equal(
    falsch({ planungZutatId: 1, menge: 2, einheit: 'dose' }),
    'Bitte eine Einheit wählen.'
  );
  assert.equal(falsch({ planungZutatId: 0, menge: 2, einheit: 'g' }), 'Diese Zutat gibt es nicht.');
  assert.equal(
    fields(() =>
      validateAbhaken({
        status: 'gekocht',
        verbrauch: Array.from({ length: 201 }, (_, i) => ({
          planungZutatId: i + 1,
          menge: 1,
          einheit: 'g',
        })),
      })
    ).verbrauch,
    'Höchstens 200 Zutaten.'
  );
});
