import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBeleg } from '../lib/validation/beleg';
import { ValidationError } from '../lib/validation/errors';

const TODAY = '2026-10-01';
const INPUT = {
  shop: 'REWE',
  date: '2026-09-30',
  amountCent: 1234,
  paidBy: 'Alex Beispiel',
  payout: true,
  kostenstelle: 'Sommerlager 2026',
  kategorie: 'Verpflegungskosten',
  note: '',
};

function fields(body: unknown, aktion?: string): Record<string, string> {
  try {
    validateBeleg(body, TODAY, aktion);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('a receipt is normalised and defaults to an expense that is submitted', () => {
  assert.deepEqual(
    validateBeleg(
      { ...INPUT, shop: '  Bäckerei   Müller ', note: ' Brötchen  ', ignored: true },
      TODAY
    ),
    {
      art: 'Ausgabe',
      ...INPUT,
      shop: 'Bäckerei Müller',
      note: 'Brötchen',
      aktion: '',
      status: 'Eingereicht',
      reviewNote: '',
    }
  );
  assert.deepEqual(
    validateBeleg(
      { ...INPUT, status: 'Abgelehnt', reviewNote: ' Beleg   unleserlich ', amountCent: 1_000_000 },
      TODAY
    ),
    {
      art: 'Ausgabe',
      ...INPUT,
      amountCent: 1_000_000,
      aktion: '',
      status: 'Abgelehnt',
      reviewNote: 'Beleg unleserlich',
    }
  );
});

test('income has no Auslage, and an invalid kind takes it away too', () => {
  const income = validateBeleg({ ...INPUT, art: 'Einnahme', paidBy: 'Alex' }, TODAY);
  assert.deepEqual([income.art, income.payout, income.paidBy], ['Einnahme', false, '']);
  assert.deepEqual(fields({ ...INPUT, art: 'Spende', paidBy: '' }), {
    art: 'Bitte eine gültige Auswahl für die Art des Belegs treffen.',
  });
  assert.deepEqual(fields({ ...INPUT, art: null }), {
    art: 'Bitte eine gültige Auswahl für die Art des Belegs treffen.',
  });
});

test('paid by the Stamm clears the person, an Auslage names one', () => {
  assert.equal(validateBeleg({ ...INPUT, payout: false }, TODAY).paidBy, '');
  assert.equal(validateBeleg({ ...INPUT, payout: 'true' }, TODAY).payout, false);
  assert.deepEqual(fields({ ...INPUT, paidBy: '' }), {
    paidBy: 'Bitte wer das Geld ausgelegt hat angeben.',
  });
  assert.equal(
    fields({ ...INPUT, payout: false, paidBy: 'x'.repeat(101) }).paidBy,
    'wer das Geld ausgelegt hat darf höchstens 100 Zeichen lang sein.'
  );
});

test('text fields report the old messages', () => {
  assert.deepEqual(
    fields({
      ...INPUT,
      shop: ' ',
      note: 'x'.repeat(1001),
      kostenstelle: 7,
      kategorie: 'x'.repeat(121),
    }),
    {
      shop: 'Bitte das Geschäft angeben.',
      note: 'die Bemerkung darf höchstens 1000 Zeichen lang sein.',
      kostenstelle: 'die Kostenstelle ist ungültig.',
      kategorie: 'die Kategorie darf höchstens 120 Zeichen lang sein.',
    }
  );
  assert.equal(fields({ ...INPUT, shop: 5 }).shop, 'das Geschäft ist ungültig.');
  assert.equal(
    fields({ ...INPUT, shop: 'x'.repeat(101) }).shop,
    'das Geschäft darf höchstens 100 Zeichen lang sein.'
  );
  assert.equal(
    fields({ ...INPUT, reviewNote: 'x'.repeat(1001) }).reviewNote,
    'die Bemerkung der Kasse darf höchstens 1000 Zeichen lang sein.'
  );
});

test('the date must be a real day in the past since 2000', () => {
  const invalid = 'Bitte ein gültiges Datum angeben.';
  assert.equal(fields({ ...INPUT, date: '' }).date, 'Bitte das Datum angeben.');
  assert.equal(fields({ ...INPUT, date: 20260930 }).date, 'das Datum ist ungültig.');
  assert.equal(fields({ ...INPUT, date: '2026-09-3x' }).date, invalid);
  assert.equal(
    fields({ ...INPUT, date: '2026-09-300000' }).date,
    'das Datum darf höchstens 10 Zeichen lang sein.'
  );
  for (const date of ['30.09.2026', '2026-02-30', '2026-13-01', '1999-12-31']) {
    assert.equal(fields({ ...INPUT, date }).date, invalid, date);
  }
  assert.equal(fields({ ...INPUT, date: '2026-10-02' }).date, 'Das Datum liegt in der Zukunft.');
  assert.equal(validateBeleg({ ...INPUT, date: TODAY }, TODAY).date, TODAY);
  assert.equal(validateBeleg({ ...INPUT, date: '2000-01-01' }, TODAY).date, '2000-01-01');
});

test('the amount is a whole number of cents above 0 up to 10.000 €', () => {
  const invalid = 'Bitte einen Betrag größer als 0 € angeben.';
  for (const amountCent of [0, -5, 12.5, '1234', null, undefined, true, NaN])
    assert.equal(fields({ ...INPUT, amountCent }).amountCent, invalid, String(amountCent));
  assert.equal(fields({ ...INPUT, amountCent: 1_000_001 }).amountCent, 'Der Betrag ist zu hoch.');
  assert.equal(fields({ ...INPUT, amountCent: 1e21 }).amountCent, 'Der Betrag ist zu hoch.');
  assert.equal(validateBeleg({ ...INPUT, amountCent: 1 }, TODAY).amountCent, 1);
});

test('the status is known, and a rejection needs a reason', () => {
  const choice = 'Bitte eine gültige Auswahl für den Status treffen.';
  assert.deepEqual(fields({ ...INPUT, status: 'Bezahlt' }), { status: choice });
  assert.deepEqual(fields({ ...INPUT, status: null }), { status: choice });
  const reason = 'Bitte begründen, warum der Beleg abgelehnt wird.';
  assert.deepEqual(fields({ ...INPUT, status: 'Abgelehnt', reviewNote: ' ' }), {
    reviewNote: reason,
  });
  assert.deepEqual(fields({ ...INPUT, status: 'Abgelehnt', reviewNote: 5 }), {
    reviewNote: reason,
  });
  assert.equal(
    fields({ ...INPUT, status: 'Abgelehnt', reviewNote: 'x'.repeat(1001) }).reviewNote,
    'die Bemerkung der Kasse darf höchstens 1000 Zeichen lang sein.'
  );
  // An unknown status never demands a reason on top
  assert.deepEqual(fields({ ...INPUT, status: 'Geprüft' }), { status: choice });
  assert.equal(validateBeleg({ ...INPUT, status: 'Angenommen' }, TODAY).status, 'Angenommen');
});

test('Kostenstelle and Kategorie are required unless an older receipt keeps its Aktion', () => {
  const body = { ...INPUT, kostenstelle: '', kategorie: ' ' };
  assert.deepEqual(fields(body), {
    kostenstelle: 'Bitte die Kostenstelle angeben.',
    kategorie: 'Bitte die Kategorie angeben.',
  });
  assert.deepEqual(validateBeleg(body, TODAY, 'Lager'), {
    art: 'Ausgabe',
    ...INPUT,
    kostenstelle: '',
    kategorie: '',
    aktion: 'Lager',
    status: 'Eingereicht',
    reviewNote: '',
  });
  // Once one of them is picked, both are needed
  assert.deepEqual(fields({ ...INPUT, kategorie: '' }, 'Lager'), {
    kategorie: 'Bitte die Kategorie angeben.',
  });
  assert.deepEqual(fields({ ...INPUT, kostenstelle: '' }, 'Lager'), {
    kostenstelle: 'Bitte die Kostenstelle angeben.',
  });
  // A sent Aktion is ignored; the stored one stays
  assert.equal(validateBeleg({ ...INPUT, aktion: 'Zeltlager' }, TODAY).aktion, '');
  assert.equal(validateBeleg(INPUT, TODAY, 'Lager').aktion, 'Lager');
});

test('a body that is no object reports the missing fields', () => {
  for (const body of [null, [], 'text', undefined])
    assert.deepEqual(fields(body), {
      shop: 'Bitte das Geschäft angeben.',
      date: 'Bitte das Datum angeben.',
      amountCent: 'Bitte einen Betrag größer als 0 € angeben.',
      kostenstelle: 'Bitte die Kostenstelle angeben.',
      kategorie: 'Bitte die Kategorie angeben.',
    });
});
