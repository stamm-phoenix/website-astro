import assert from 'node:assert/strict';
import test from 'node:test';
import { stufeFuerAlter, validateSchnupperAnfrage } from '../lib/schnupper-model';
import { ValidationError } from '../lib/validation/errors';
import {
  validateSchnupperAbsage,
  validateSchnupperBestaetigung,
} from '../lib/validation/schnupper';

const ANFRAGE = {
  alter: '8',
  stufe: 'woelflinge',
  kindVorname: '  Mia ',
  name: ' Erika\nMuster ',
  email: ' erika@example.test ',
  telefon: '',
  wunschzeit: 'Nach den Herbstferien',
  nachricht: 'Sie ist schüchtern.\nViele Grüße',
};

function errorsOf(work: () => unknown): Record<string, string> {
  try {
    work();
  } catch (error: unknown) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return {};
}

test('a request is trimmed, the age read as a number and the name kept on one line', () => {
  const { anfrage, errors } = validateSchnupperAnfrage(ANFRAGE);
  assert.deepEqual(errors, {});
  assert.deepEqual(anfrage, {
    alter: 8,
    stufe: 'woelflinge',
    kindVorname: 'Mia',
    name: 'Erika Muster',
    email: 'erika@example.test',
    telefon: '',
    wunschzeit: 'Nach den Herbstferien',
    nachricht: 'Sie ist schüchtern.\nViele Grüße',
  });
});

test('a request names every invalid field in German', () => {
  const { anfrage, errors } = validateSchnupperAnfrage({
    alter: 3,
    stufe: 'biber',
    name: ' ',
    email: 'kaputt',
    telefon: 'ruf mich an',
    wunschzeit: '',
    nachricht: 'x'.repeat(2001),
  });
  assert.equal(anfrage, null);
  assert.deepEqual(Object.keys(errors).sort(), [
    'alter',
    'email',
    'nachricht',
    'name',
    'stufe',
    'telefon',
    'wunschzeit',
  ]);
  assert.equal(errors.alter, 'Bitte gib das Alter in Jahren an (5 bis 25).');
  assert.equal(errors.stufe, 'Bitte wähle eine Stufe oder „Weiß ich nicht“.');
});

test('a fraction or text is no age', () => {
  for (const alter of [8.5, 'acht', '', null]) {
    assert.ok(validateSchnupperAnfrage({ ...ANFRAGE, alter }).errors.alter, String(alter));
  }
});

test('the Stufe follows the age ranges of the Gruppenstunden', () => {
  assert.deepEqual([6, 9, 10, 12, 13, 15, 16, 20].map(stufeFuerAlter), [
    'woelflinge',
    'woelflinge',
    'jupfis',
    'jupfis',
    'pfadis',
    'pfadis',
    'rover',
    'rover',
  ]);
});

test('a confirmation needs a date from today on and a time', () => {
  const input = validateSchnupperBestaetigung(
    { datum: '2026-11-10', zeit: '17:30', ort: ' Pfarrheim ', antwort: ' Bis bald!\nGut Pfad ' },
    '2026-11-02'
  );
  assert.deepEqual(input, {
    datum: '2026-11-10',
    zeit: '17:30',
    ort: 'Pfarrheim',
    antwort: 'Bis bald!\nGut Pfad',
  });

  assert.deepEqual(
    errorsOf(() =>
      validateSchnupperBestaetigung({ datum: '2026-11-01', zeit: '25:00' }, '2026-11-02')
    ),
    {
      datum: 'Das Datum liegt in der Vergangenheit.',
      zeit: 'Bitte eine Uhrzeit wie 17:00 angeben.',
    }
  );
  assert.deepEqual(
    Object.keys(
      errorsOf(() => validateSchnupperBestaetigung({ datum: '2026-02-30' }, '2026-01-01'))
    ),
    ['datum', 'zeit']
  );
});

test('a cancellation may come without a text, but not with one that is too long', () => {
  assert.deepEqual(validateSchnupperAbsage(null), { antwort: '' });
  assert.deepEqual(
    Object.keys(errorsOf(() => validateSchnupperAbsage({ antwort: 'x'.repeat(2001) }))),
    ['antwort']
  );
});

test('an address that would add recipients to a mail link is refused', () => {
  for (const email of [
    'erika@example.test?bcc=fremd%40example.test',
    'erika@example.test&cc=fremd@example.test',
    'erika@example.test,fremd@example.test',
    'eri#ka@example.test',
  ]) {
    assert.ok(validateSchnupperAnfrage({ ...ANFRAGE, email }).errors.email, email);
  }
  for (const email of ['erika.muster+schnupper@example.test', 'jörg@müller-beispiel.de']) {
    assert.equal(validateSchnupperAnfrage({ ...ANFRAGE, email }).errors.email, undefined, email);
  }
});
