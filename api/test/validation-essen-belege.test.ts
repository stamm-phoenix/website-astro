import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heuteInBerlin,
  readBelegFotoArt,
  validateBeleg,
  validateBelegAenderung,
} from '../lib/essen-belege-validation';
import { fields } from './fixtures/essen-fields';

const HEUTE = '2026-11-01';

test('a receipt needs a day, an amount and who paid it', () => {
  assert.deepEqual(
    validateBeleg(
      { datum: '2026-10-30', betragCent: 1234, haendler: '  Rewe   Markt ', bezahltVonId: 3 },
      HEUTE
    ),
    {
      datum: '2026-10-30',
      betragCent: 1234,
      haendler: 'Rewe Markt',
      notiz: '',
      bezahltVonId: 3,
      bezahltVonText: '',
      erstattet: false,
    }
  );
  assert.deepEqual(
    validateBeleg(
      { datum: HEUTE, betragCent: 5, bezahltVonText: ' Oma Inge ', erstattet: true },
      HEUTE
    ),
    {
      datum: HEUTE,
      betragCent: 5,
      haendler: '',
      notiz: '',
      bezahltVonId: null,
      bezahltVonText: 'Oma Inge',
      erstattet: true,
    }
  );
  assert.deepEqual(
    fields(() => validateBeleg(null, HEUTE)),
    {
      datum: 'Bitte ein gültiges Datum angeben.',
      betragCent: 'Bitte einen Betrag größer als 0 € angeben.',
      bezahltVonText: 'Bitte angeben, wer bezahlt hat.',
    }
  );
});

test('the fields of a receipt report in German', () => {
  assert.deepEqual(
    fields(() =>
      validateBeleg(
        {
          datum: '2026-11-02',
          betragCent: 12.5,
          haendler: 'x'.repeat(101),
          bezahltVonId: 2,
          bezahltVonText: 'Ben',
          erstattet: 'ja',
        },
        HEUTE
      )
    ),
    {
      datum: 'Das Datum liegt in der Zukunft.',
      betragCent: 'Bitte den Betrag in Euro und Cent angeben, z. B. 12,34.',
      haendler: 'Höchstens 100 Zeichen.',
      erstattet: 'Bitte ankreuzen oder nicht.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateBeleg({ datum: HEUTE, betragCent: 1, bezahltVonId: 2, bezahltVonText: 'Ben' }, HEUTE)
    ),
    { bezahltVonText: 'Entweder ein Mitglied oder einen Namen.' }
  );
  assert.deepEqual(
    fields(() =>
      validateBeleg({ datum: '2026-02-30', betragCent: 2_000_000, bezahltVonId: -1 }, HEUTE)
    ),
    {
      datum: 'Bitte ein gültiges Datum angeben.',
      betragCent: 'Höchstens 10.000 €. Bitte den Betrag prüfen.',
      bezahltVonId: 'Bitte aus der Liste wählen.',
    }
  );
});

test('a change keeps only the sent fields', () => {
  assert.deepEqual(validateBelegAenderung({ erstattet: true, etag: '"x"' }, HEUTE), {
    erstattet: true,
  });
  assert.deepEqual(validateBelegAenderung({ haendler: '  Aldi ' }, HEUTE), { haendler: 'Aldi' });
  assert.deepEqual(validateBelegAenderung({ bezahltVonId: 4 }, HEUTE), {
    bezahltVon: { bezahltVonId: 4, bezahltVonText: '' },
  });
  assert.deepEqual(
    fields(() => validateBelegAenderung({ bezahltVonText: ' ' }, HEUTE)),
    { bezahltVonText: 'Bitte angeben, wer bezahlt hat.' }
  );
  assert.deepEqual(
    fields(() => validateBelegAenderung({}, HEUTE)),
    { form: 'Es gibt nichts zu speichern.' }
  );
  assert.deepEqual(
    fields(() => validateBelegAenderung({ notiz: 5, betragCent: 0 }, HEUTE)),
    { notiz: 'Bitte als Text angeben.', betragCent: 'Bitte einen Betrag größer als 0 € angeben.' }
  );
});

test('the picture asked for falls back to the picture itself', () => {
  assert.equal(readBelegFotoArt('vorschau'), 'vorschau');
  assert.equal(readBelegFotoArt('datei'), 'datei');
  assert.equal(readBelegFotoArt('../etwas'), 'bild');
  assert.equal(readBelegFotoArt(null), 'bild');
});

test('today is the day in Berlin', () => {
  assert.equal(heuteInBerlin(new Date('2026-10-31T23:30:00Z')), '2026-11-01');
});
