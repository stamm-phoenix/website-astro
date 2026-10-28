import assert from 'node:assert/strict';
import test from 'node:test';
import { KjrListeInputError, parseKjrListeRequest } from '../lib/kjr-teilnahmeliste';
import { toKjrPerson } from '../lib/kjr-zuschuss';

const PERSON = { lastName: 'Muster', firstName: 'Max' };

function message(body: Record<string, unknown> | null): string {
  try {
    parseKjrListeRequest(body);
  } catch (error) {
    if (error instanceof KjrListeInputError) return error.message;
    throw error;
  }
  return assert.fail('Expected a KjrListeInputError.');
}

const withPerson = (extra: Record<string, unknown>) => ({ persons: [{ ...PERSON, ...extra }] });

test('parseKjrListeRequest trims the header fields and derives the persons', () => {
  assert.deepEqual(parseKjrListeRequest({ persons: [] }), {
    ort: '',
    plz: '',
    beginnZeit: '',
    endeZeit: '',
    persons: [],
  });
  assert.deepEqual(
    parseKjrListeRequest({
      ort: '  Haus am See ',
      plz: '83022',
      beginn: '08:00',
      ende: '23:59',
      persons: [
        { lastName: ' Muster ', firstName: null, gender: 'm', age: 30, plz: '83022' },
        { firstName: 'Lea', age: 12, plz: '', betreuer: true },
        { lastName: 'Kind', gender: '', age: null, betreuer: false },
        { lastName: 'Alt', age: 120, plz: '12345' },
        { lastName: 'Neu', age: 0, gender: 'd' },
      ],
    }),
    {
      ort: 'Haus am See',
      plz: '83022',
      beginnZeit: '08:00',
      endeZeit: '23:59',
      persons: [
        toKjrPerson({
          lastName: 'Muster',
          firstName: '',
          gender: 'm',
          age: 30,
          plz: '83022',
          betreuer: false,
        }),
        toKjrPerson({
          lastName: '',
          firstName: 'Lea',
          gender: '',
          age: 12,
          plz: '',
          betreuer: true,
        }),
        toKjrPerson({
          lastName: 'Kind',
          firstName: '',
          gender: '',
          age: null,
          plz: '',
          betreuer: false,
        }),
        toKjrPerson({
          lastName: 'Alt',
          firstName: '',
          gender: '',
          age: 120,
          plz: '12345',
          betreuer: false,
        }),
        toKjrPerson({
          lastName: 'Neu',
          firstName: '',
          gender: 'd',
          age: 0,
          plz: '',
          betreuer: false,
        }),
      ],
    }
  );
});

test('parseKjrListeRequest reports the message of every header rule', () => {
  assert.equal(message(null), 'Die Anfrage ist leer oder kein JSON.');
  for (const ort of [5, 'x'.repeat(201), {}]) {
    assert.equal(message({ ort, persons: [] }), 'Ungültige Angabe: Veranstaltungsort.');
  }
  assert.equal(parseKjrListeRequest({ ort: 'x'.repeat(200), persons: [] }).ort.length, 200);
  for (const plz of [83022, '123456', ' 83022']) {
    assert.equal(message({ plz, persons: [] }), 'Ungültige Angabe: Postleitzahl.');
  }
  for (const plz of ['8302', 'abcde']) {
    assert.equal(message({ plz, persons: [] }), 'Die Postleitzahl muss fünfstellig sein.');
  }
  assert.equal(message({ beginn: 800, persons: [] }), 'Ungültige Angabe: Beginn.');
  assert.equal(message({ beginn: ' 8:00 ', persons: [] }), 'Ungültige Angabe: Beginn.');
  assert.equal(message({ ende: true, persons: [] }), 'Ungültige Angabe: Ende.');
  for (const [beginn, ende] of [
    ['8:00', ''],
    ['24:00', ''],
    ['', '12:60'],
    ['08:00', 'spät'],
  ]) {
    assert.equal(message({ beginn, ende, persons: [] }), 'Uhrzeiten bitte als HH:MM angeben.');
  }
  for (const persons of [undefined, null, 'x', {}, Array.from({ length: 501 }, () => PERSON)]) {
    assert.equal(message({ persons }), 'Ungültige Liste der Personen.');
  }
  assert.equal(
    parseKjrListeRequest({ persons: Array.from({ length: 500 }, () => PERSON) }).persons.length,
    500
  );
});

test('parseKjrListeRequest reports the message of every person rule with the position', () => {
  for (const person of [null, undefined, 'Max', 5, true]) {
    assert.equal(message({ persons: [PERSON, person] }), 'Ungültige Person Nr. 2.');
  }
  assert.equal(message({ persons: [[]] }), 'Person Nr. 1 hat keinen Namen.');
  assert.equal(
    message({ persons: [PERSON, { lastName: ' ', firstName: '' }] }),
    'Person Nr. 2 hat keinen Namen.'
  );
  assert.equal(message(withPerson({ lastName: 5 })), 'Ungültige Angabe: Nachname (Person Nr. 1).');
  assert.equal(
    message(withPerson({ lastName: 'x'.repeat(101) })),
    'Ungültige Angabe: Nachname (Person Nr. 1).'
  );
  assert.equal(message(withPerson({ firstName: [] })), 'Ungültige Angabe: Vorname (Person Nr. 1).');
  assert.equal(
    parseKjrListeRequest(withPerson({ lastName: 'x'.repeat(100) })).persons[0].lastName.length,
    100
  );
  assert.equal(message(withPerson({ gender: 'x' })), 'Ungültiges Geschlecht (Person Nr. 1).');
  for (const gender of ['mm', ' m', 1]) {
    assert.equal(message(withPerson({ gender })), 'Ungültige Angabe: Geschlecht (Person Nr. 1).');
  }
  for (const age of ['5', 1.5, -1, 121, true, NaN]) {
    assert.equal(message(withPerson({ age })), 'Ungültiges Alter (Person Nr. 1).');
  }
  assert.equal(message(withPerson({ plz: '123' })), 'Ungültige PLZ (Person Nr. 1).');
  for (const plz of [83022, '123456', ' 83022']) {
    assert.equal(message(withPerson({ plz })), 'Ungültige Angabe: PLZ (Person Nr. 1).');
  }
  for (const betreuer of ['ja', 1, []]) {
    assert.equal(message(withPerson({ betreuer })), 'Ungültige Rolle (Person Nr. 1).');
  }
});
