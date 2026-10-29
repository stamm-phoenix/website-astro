import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readDatum,
  readPosition,
  validateMahlzeit,
  validatePlanungEinstellungen,
  validateTag,
} from '../lib/essen-planung-model';
import { fields } from './fixtures/essen-fields';

const NAME_FEHLT = 'Bitte einen Namen eintragen.';
const JA_NEIN = 'Bitte ja oder nein wählen.';
const NICHTS = 'Es gibt nichts zu speichern.';

test('Einstellungen: only the sent fields are read, with what the form started from', () => {
  assert.deepEqual(validatePlanungEinstellungen({ name: ' Neu  Name ' }), {
    name: { neu: 'Neu Name' },
  });
  assert.deepEqual(validatePlanungEinstellungen({ name: 'Neu', vorher: { name: 'Alt' } }), {
    name: { neu: 'Neu', vorher: 'Alt' },
  });
  assert.deepEqual(validatePlanungEinstellungen({ mitgliederVerwalten: true }), {
    mitgliederVerwalten: { neu: true },
  });
  assert.deepEqual(
    validatePlanungEinstellungen({
      name: 'N',
      mitgliederVerwalten: false,
      vorher: { name: 'A', mitgliederVerwalten: true },
    }),
    { name: { neu: 'N', vorher: 'A' }, mitgliederVerwalten: { neu: false, vorher: true } }
  );
  // A `vorher` of the wrong type is left out; a missing one means the field is simply set
  assert.deepEqual(
    validatePlanungEinstellungen({
      name: 'N',
      mitgliederVerwalten: true,
      vorher: { name: 3, mitgliederVerwalten: 'ja' },
    }),
    { name: { neu: 'N' }, mitgliederVerwalten: { neu: true } }
  );
  for (const vorher of [null, 'x', 5, ['a'], undefined]) {
    assert.deepEqual(validatePlanungEinstellungen({ name: 'N', vorher }), { name: { neu: 'N' } });
  }
  assert.equal(validatePlanungEinstellungen({ name: 'x'.repeat(150) }).name?.neu.length, 150);
  // Other keys are ignored
  assert.deepEqual(validatePlanungEinstellungen({ name: 'N', anderes: 1 }), {
    name: { neu: 'N' },
  });
});

test('Einstellungen: errors', () => {
  for (const input of [undefined, null, 'x', 3, [], {}, { vorher: { name: 'a' } }]) {
    assert.deepEqual(
      fields(() => validatePlanungEinstellungen(input)),
      { name: NICHTS }
    );
  }
  for (const name of ['', '  ', null, 3, {}]) {
    assert.deepEqual(
      fields(() => validatePlanungEinstellungen({ name })),
      { name: NAME_FEHLT }
    );
  }
  assert.deepEqual(
    fields(() => validatePlanungEinstellungen({ name: 'x'.repeat(151) })),
    {
      name: 'Höchstens 150 Zeichen.',
    }
  );
  for (const mitgliederVerwalten of [null, 'true', 1, 0, '', {}]) {
    assert.deepEqual(
      fields(() => validatePlanungEinstellungen({ mitgliederVerwalten })),
      {
        mitgliederVerwalten: JA_NEIN,
      }
    );
  }
  assert.deepEqual(
    fields(() => validatePlanungEinstellungen({ name: '', mitgliederVerwalten: 1 })),
    {
      name: NAME_FEHLT,
      mitgliederVerwalten: JA_NEIN,
    }
  );
  // An invalid field is no reason for the message that nothing was sent
  assert.deepEqual(
    fields(() => validatePlanungEinstellungen({ name: 'ok', mitgliederVerwalten: 'x' })),
    { mitgliederVerwalten: JA_NEIN }
  );
});

test('Tag: a valid calendar date', () => {
  assert.equal(validateTag({ datum: '2027-07-24' }), '2027-07-24');
  assert.equal(validateTag({ datum: '2028-02-29' }), '2028-02-29');
  for (const input of [
    {},
    null,
    'x',
    { datum: '' },
    { datum: ' 2027-07-24' },
    { datum: '2027-02-29' },
    { datum: '2027-00-10' },
    { datum: '2027-07-32' },
    { datum: '2027-7-24' },
    { datum: 20270724 },
    { datum: '2027-07-24T00:00:00Z' },
  ]) {
    assert.deepEqual(
      fields(() => validateTag(input)),
      { datum: 'Bitte ein Datum wählen.' }
    );
  }
});

test('Datum: reads a calendar date or nothing', () => {
  assert.equal(readDatum('2027-07-24'), '2027-07-24');
  assert.equal(readDatum('2000-02-29'), '2000-02-29');
  assert.equal(readDatum('1900-02-29'), undefined);
  assert.equal(readDatum('2027-04-31'), undefined);
  assert.equal(readDatum(undefined), undefined);
  assert.equal(readDatum(null), undefined);
  assert.equal(readDatum(20270724), undefined);
});

test('Mahlzeit: name and optional time', () => {
  assert.deepEqual(validateMahlzeit({ name: ' Mittag   essen ' }), {
    name: 'Mittag essen',
    uhrzeit: null,
  });
  assert.deepEqual(validateMahlzeit({ name: 'x'.repeat(50) }).name.length, 50);
  for (const uhrzeit of [undefined, null, '', '   ', 12, true, {}]) {
    assert.equal(validateMahlzeit({ name: 'A', uhrzeit }).uhrzeit, null);
  }
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: '12:30' }).uhrzeit, '12:30');
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: ' 07:05 ' }).uhrzeit, '07:05');
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: '00:00' }).uhrzeit, '00:00');
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: '23:59' }).uhrzeit, '23:59');
  // Only the first five characters count
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: '12:30:45' }).uhrzeit, '12:30');
  assert.equal(validateMahlzeit({ name: 'A', uhrzeit: '12:30xyz' }).uhrzeit, '12:30');
  for (const uhrzeit of ['24:00', '12:60', '7:30', '1230', 'abc', '12-30', '12:3', '99:99']) {
    assert.deepEqual(
      fields(() => validateMahlzeit({ name: 'A', uhrzeit })),
      {
        uhrzeit: 'Bitte eine Uhrzeit wie 12:30 eintragen.',
      }
    );
  }
});

test('Mahlzeit: name errors', () => {
  for (const input of [undefined, null, 'x', {}, { name: ' ' }, { name: 4 }]) {
    assert.deepEqual(
      fields(() => validateMahlzeit(input)),
      { name: NAME_FEHLT }
    );
  }
  assert.deepEqual(
    fields(() => validateMahlzeit({ name: 'x'.repeat(51) })),
    {
      name: 'Höchstens 50 Zeichen.',
    }
  );
  assert.deepEqual(
    fields(() => validateMahlzeit({ name: '', uhrzeit: 'x' })),
    {
      name: NAME_FEHLT,
      uhrzeit: 'Bitte eine Uhrzeit wie 12:30 eintragen.',
    }
  );
});

test('Position: an integer from 1 to 100 or nothing', () => {
  for (const position of [1, 2, 50, 100]) assert.equal(readPosition(position), position);
  for (const position of [0, -1, 101, 1.5, NaN, Infinity, '3', null, undefined, {}, [1], true]) {
    assert.equal(readPosition(position), undefined);
  }
});
