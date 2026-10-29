import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGruppe, validateTeilnehmende } from '../lib/essen-teilnehmende-validation';
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

test('a group takes a trimmed name and a factor with a comma', () => {
  assert.deepEqual(validateGruppe({ name: '  Rover  Plus ', faktor: '1,2' }), {
    name: 'Rover Plus',
    faktor: 1.2,
  });
  assert.deepEqual(
    fields(() => validateGruppe(undefined)),
    {
      name: 'Bitte einen Namen eintragen.',
      faktor: 'Bitte einen Faktor von 0,01 bis 5 eintragen, z. B. 0,7.',
    }
  );
  assert.equal(
    fields(() => validateGruppe({ name: 'x'.repeat(51), faktor: 1 })).name,
    'Höchstens 50 Zeichen.'
  );
  assert.ok(fields(() => validateGruppe({ name: 'Wö', faktor: 0.005 })).faktor);
});

test('participants read the count as text and sort their intolerances', () => {
  assert.deepEqual(
    validateTeilnehmende({
      gruppeId: 3,
      ernaehrung: 'vegan',
      anzahl: ' 12 ',
      unvertraeglichkeiten: [5, 1, 5],
      hinweis: '  reisen später an ',
    }),
    {
      gruppeId: 3,
      ernaehrung: 'vegan',
      anzahl: 12,
      unvertraeglichkeiten: [1, 5],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
      hinweis: 'reisen später an',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateTeilnehmende({
        gruppeId: 0,
        ernaehrung: 'fleisch',
        anzahl: 2001,
        unvertraeglichkeiten: ['a'],
        vonMahlzeitId: -1,
        hinweis: 'x'.repeat(201),
      })
    ),
    {
      gruppeId: 'Bitte eine Gruppe wählen.',
      ernaehrung: 'Bitte eine Ernährung wählen.',
      anzahl: 'Bitte eine Anzahl von 1 bis 2000 eintragen.',
      unvertraeglichkeiten: 'Bitte aus der Liste wählen.',
      vonMahlzeitId: 'Bitte eine Mahlzeit wählen.',
      hinweis: 'Höchstens 200 Zeichen.',
    }
  );
});
