import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readHakenEtag,
  validateEinkauf,
  validateHaken,
  validateRegel,
  validateVerschieben,
  validateZurueckholen,
} from '../lib/essen-einkaeufe-validation';
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

test('a shopping trip has a name; date, shop and last meal are optional', () => {
  assert.deepEqual(validateEinkauf({ name: '  Metro   Montag ' }), {
    name: 'Metro Montag',
    datum: null,
    geschaeftId: null,
    bisMahlzeitId: null,
    abgeschlossen: false,
  });
  assert.deepEqual(
    validateEinkauf({
      name: 'Bäcker',
      datum: '2027-08-02',
      geschaeftId: 3,
      bisMahlzeitId: '',
      abgeschlossen: true,
    }),
    {
      name: 'Bäcker',
      datum: '2027-08-02',
      geschaeftId: 3,
      bisMahlzeitId: null,
      abgeschlossen: true,
    }
  );
  assert.deepEqual(
    fields(() =>
      validateEinkauf({
        name: ' ',
        datum: '2027-02-30',
        geschaeftId: 1.5,
        bisMahlzeitId: -1,
        abgeschlossen: 'ja',
      })
    ),
    {
      name: 'Bitte einen Namen eintragen.',
      datum: 'Bitte ein Datum wählen oder das Feld leer lassen.',
      geschaeftId: 'Bitte ein Geschäft wählen.',
      bisMahlzeitId: 'Bitte eine Mahlzeit wählen.',
      abgeschlossen: 'Bitte angeben, ob der Einkauf abgeschlossen ist.',
    }
  );
  assert.equal(
    fields(() => validateEinkauf({ name: 'x'.repeat(81) })).name,
    'Höchstens 80 Zeichen.'
  );
});

test('ticking off keeps what was bought, rounded as stored, and a replacement', () => {
  assert.deepEqual(
    validateHaken({ planungZutatId: 4, einheit: 'l', erhalten: 3.0004, ersatz: ' Pepsi  Cola ' }),
    { planungZutatId: 4, einheit: 'l', erhalten: 3, ersatz: 'Pepsi Cola' }
  );
  // Without an amount (a thing by eye) it is 0; a tiny one stays a little
  assert.equal(validateHaken({ planungZutatId: 4, einheit: 'g' }).erhalten, 0);
  assert.equal(
    validateHaken({ planungZutatId: 4, einheit: 'g', erhalten: 0.0001 }).erhalten,
    0.001
  );
  assert.deepEqual(
    fields(() =>
      validateHaken({ planungZutatId: 0, einheit: 'dose', erhalten: -1, ersatz: 'x'.repeat(101) })
    ),
    {
      planungZutatId: 'Diese Zutat gibt es nicht.',
      einheit: 'Bitte eine Einheit wählen.',
      erhalten: 'Bitte eine Menge ab 0 eintragen, z. B. 2,5.',
      ersatz: 'Höchstens 100 Zeichen.',
    }
  );
  assert.equal(
    fields(() => validateHaken({ planungZutatId: 1, einheit: 'g', erhalten: 2_000_000 })).erhalten,
    'Die Menge ist zu groß.'
  );
});

test('only a fixed amount keeps an amount; a rule can be taken away', () => {
  assert.deepEqual(validateRegel({ planungZutatId: 2, art: 'fest', menge: 1.5, einheit: 'kg' }), {
    planungZutatId: 2,
    art: 'fest',
    menge: 1.5,
    einheit: 'kg',
  });
  assert.deepEqual(validateRegel({ planungZutatId: 2, art: 'ohne', menge: 3, einheit: 'g' }), {
    planungZutatId: 2,
    art: 'ohne',
    menge: null,
    einheit: null,
  });
  assert.equal(validateRegel({ planungZutatId: 2, art: null }).art, null);
  assert.equal(validateRegel({ planungZutatId: 2 }).art, null);
  assert.deepEqual(
    fields(() => validateRegel({ planungZutatId: 2, art: 'fest' })),
    {
      menge: 'Bitte eine feste Menge ab 0 eintragen, z. B. 2,5.',
      einheit: 'Bitte eine Einheit wählen.',
    }
  );
  assert.deepEqual(
    fields(() => validateRegel({ planungZutatId: 2, art: 'irgendwo' })),
    {
      art: 'Bitte wählen, was mit der Zutat in diesem Einkauf passiert.',
    }
  );
});

test('moving names the ingredient and the other trip', () => {
  assert.deepEqual(validateVerschieben({ planungZutatId: 1, nachEinkaufId: 2 }), {
    planungZutatId: 1,
    nachEinkaufId: 2,
  });
  assert.deepEqual(
    fields(() => validateVerschieben({ planungZutatId: 1 })),
    {
      nachEinkaufId: 'Bitte einen Einkauf wählen.',
    }
  );
});

test('the version of something ticked off is read only when it is one', () => {
  assert.equal(readHakenEtag({ etag: '"0000000000000ABC"' }), '"0000000000000ABC"');
  assert.equal(readHakenEtag({ etag: null }), null);
  assert.equal(readHakenEtag({ etag: 'kaputt' }), null);
  assert.equal(readHakenEtag(null), null);
});

test('taking back names the ingredient', () => {
  assert.deepEqual(validateZurueckholen({ planungZutatId: 3, x: 1 }), { planungZutatId: 3 });
  assert.deepEqual(
    fields(() => validateZurueckholen({ planungZutatId: 'a' })),
    { planungZutatId: 'Diese Zutat gibt es nicht.' }
  );
});
