import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateGeschaeft,
  validatePosten,
  validateZutatGeschaeft,
} from '../lib/essen-einkauf-validation';
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

test('a shop needs a name of up to 80 characters', () => {
  assert.deepEqual(validateGeschaeft({ name: '  Bäckerei   am Platz ' }), {
    name: 'Bäckerei am Platz',
  });
  assert.deepEqual(
    fields(() => validateGeschaeft(null)),
    { name: 'Bitte einen Namen eintragen.' }
  );
  assert.deepEqual(
    fields(() => validateGeschaeft({ name: 'x'.repeat(81) })),
    {
      name: 'Höchstens 80 Zeichen.',
    }
  );
});

test('an entry of stock or extra needs picks an ingredient, an amount and a unit', () => {
  assert.deepEqual(validatePosten({ zutatId: 4, menge: 1.23456, einheit: 'kg' }, 'bestand'), {
    zutat: { zutatId: 4 },
    menge: 1.235,
    einheit: 'kg',
    hinweis: '',
  });
  assert.deepEqual(
    validatePosten(
      { planungZutatId: 9, menge: 3, einheit: 'stueck', hinweis: ' x ' },
      'zusatzbedarf'
    ),
    {
      zutat: { planungZutatId: 9 },
      menge: 3,
      einheit: 'stueck',
      hinweis: 'x',
    }
  );
  assert.deepEqual(
    fields(() => validatePosten({ menge: 0, einheit: '', hinweis: 'y'.repeat(201) }, 'bestand')),
    {
      zutat: 'Bitte eine Zutat wählen.',
      menge: 'Bitte eine Menge größer 0 eintragen, z. B. 2,5.',
      einheit: 'Bitte eine Einheit wählen.',
      hinweis: 'Höchstens 200 Zeichen.',
    }
  );
  assert.deepEqual(
    fields(() => validatePosten({ zutatId: 1, menge: 2_000_000, einheit: 'g' }, 'bestand')),
    {
      menge: 'Die Menge ist zu groß.',
    }
  );
});

test('extra needs may name a thing of their own and go without an amount', () => {
  assert.deepEqual(validatePosten({ name: '  Koch   handschuhe ' }, 'zusatzbedarf'), {
    zutat: { name: 'Koch handschuhe' },
    menge: null,
    einheit: null,
    hinweis: '',
  });
  // Without an amount the unit goes too; a chosen ingredient wins over a typed name
  assert.deepEqual(
    validatePosten({ planungZutatId: 3, name: 'x', menge: '', einheit: 'g' }, 'zusatzbedarf'),
    { zutat: { planungZutatId: 3 }, menge: null, einheit: null, hinweis: '' }
  );
  assert.deepEqual(
    fields(() => validatePosten({ name: 'Kochhandschuhe', menge: 2 }, 'zusatzbedarf')),
    { einheit: 'Bitte eine Einheit wählen.' }
  );
  assert.deepEqual(
    fields(() => validatePosten({ name: '' }, 'zusatzbedarf')),
    {
      zutat: 'Bitte eine Zutat wählen oder eintragen, was gebraucht wird.',
    }
  );
  // The stock always has an ingredient of the list and an amount
  assert.deepEqual(
    fields(() => validatePosten({ name: 'Kochhandschuhe' }, 'bestand')),
    {
      zutat: 'Bitte eine Zutat wählen.',
      menge: 'Bitte eine Menge größer 0 eintragen, z. B. 2,5.',
    }
  );
  assert.deepEqual(
    fields(() => validatePosten({ name: 'x'.repeat(151) }, 'zusatzbedarf')),
    // A name of its own is typed in the field of the ingredient
    {
      zutat: 'Höchstens 150 Zeichen.',
    }
  );
});

test('the shop of an ingredient is an id or none', () => {
  assert.equal(validateZutatGeschaeft({ geschaeftId: 5 }), 5);
  assert.equal(validateZutatGeschaeft({ geschaeftId: null }), null);
  assert.equal(validateZutatGeschaeft({}), null);
  assert.deepEqual(
    fields(() => validateZutatGeschaeft({ geschaeftId: 'x' })),
    {
      geschaeftId: 'Bitte ein Geschäft wählen.',
    }
  );
});
