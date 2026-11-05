import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampflowPerson } from '../lib/campflow';
import { gleicheAb, strasseKey, telefonKey } from '../lib/nami-abgleich';
import type { NamiMitglied } from '../lib/nami-schema';

const TODAY = '2026-11-05';
const LOADED = {
  nami: new Date('2026-11-05T10:00:00Z'),
  campflow: new Date('2026-11-05T10:01:00Z'),
};

function nami(
  id: number,
  vorname: string,
  nachname: string,
  extra: Partial<NamiMitglied> = {}
): NamiMitglied {
  return {
    id,
    mitgliedsnummer: String(id),
    vorname,
    nachname,
    spitzname: '',
    geburtsdatum: '2015-03-01',
    geschlecht: 'weiblich',
    email: '',
    emailVertretungsberechtigter: 'eltern@example.org',
    telefon: ['08063 12345'],
    eintritt: '2022-09-01',
    austritt: null,
    status: 'Aktiv',
    mitgliedstyp: 'Mitglied',
    stufe: 'Wölfling',
    adresse: { strasse: 'Hauptstr. 3', plz: '83620', ort: 'Feldkirchen-Westerham' },
    ...extra,
  };
}

function campflow(
  id: string,
  first: string,
  last: string,
  extra: Partial<CampflowPerson> = {}
): CampflowPerson {
  return {
    id,
    name: { first_name: first, last_name: last },
    gender: 'f',
    birthdate: '2015-03-01',
    primary_email: 'Eltern@example.org',
    cc_emails: [],
    phone_numbers: [{ number: '+49 8063 12345', label: 'Mama' }],
    address: { street: 'Hauptstraße 3', postcode: '83620', city: 'Feldkirchen-Westerham' },
    membership_number: null,
    join_date: '2022-09-01',
    leave_date: null,
    group_names: ['🟠 Wölfling'],
    ...extra,
  };
}

test('the same Mitgliedsnummer links two people even with other names', () => {
  const result = gleicheAb(
    [nami(1001, 'Anna', 'Muster')],
    [campflow('per_A', 'Anni', 'Muster-Huber', { membership_number: '01001' })],
    TODAY,
    LOADED
  );
  assert.equal(result.paare.length, 1);
  assert.equal(result.paare[0].verbindung, 'mitgliedsnummer');
  const unterschiede = result.paare[0].felder.filter((f) => !f.gleich).map((f) => f.feld);
  assert.deepEqual(unterschiede, ['vorname', 'nachname']);
  assert.equal(result.paare[0].felder.find((f) => f.feld === 'vorname')?.nami, 'Anna');
});

test('name and birthday link people; spelling that means the same is no difference', () => {
  const result = gleicheAb(
    [nami(1, 'Jörg Peter', 'Müller')],
    [campflow('per_J', 'Jörg', 'Mueller')],
    TODAY,
    LOADED
  );
  assert.equal(result.paare[0].verbindung, 'name-geburtsdatum');
  const felder = Object.fromEntries(result.paare[0].felder.map((f) => [f.feld, f.gleich]));
  // Umlauts spelled out, Hauptstr./Hauptstraße, +49 and the e-mail in other case are the same
  assert.equal(felder.nachname, true);
  assert.equal(felder.strasse, true);
  assert.equal(felder.telefon, true);
  assert.equal(felder.email, true);
  assert.equal(felder.geschlecht, true);
  assert.equal(felder.stufe, true);
  // The second first name is a real difference
  assert.equal(felder.vorname, false);
  // CampFlow keeps no Mitgliedsnummer here
  assert.equal(felder.mitgliedsnummer, false);
});

test('siblings with the same birthday are not linked by birthday alone', () => {
  const result = gleicheAb(
    [nami(1, 'Lena', 'Berger'), nami(2, 'Lisa', 'Berger')],
    [campflow('per_1', 'Helena', 'Berger'), campflow('per_2', 'Elisa', 'Berger')],
    TODAY,
    LOADED
  );
  assert.equal(result.paare.length, 0);
  assert.equal(result.nurNami.length, 2);
  assert.equal(result.nurCampflow.length, 2);
});

test('a unique birthday and last name link a person to be checked', () => {
  const result = gleicheAb(
    [nami(1, 'Maximilian', 'Huber')],
    [campflow('per_M', 'Max', 'Huber')],
    TODAY,
    LOADED
  );
  assert.equal(result.paare[0].verbindung, 'geburtsdatum');
});

test('people in only one list are listed with their state', () => {
  const result = gleicheAb(
    [
      nami(1, 'Anna', 'Muster'),
      nami(2, 'Otto', 'Alt', { status: 'Inaktiv', austritt: '2020-01-01' }),
    ],
    [
      campflow('per_A', 'Anna', 'Muster'),
      campflow('per_N', 'Neu', 'Kind', { birthdate: '2018-01-01' }),
    ],
    TODAY,
    LOADED
  );
  assert.deepEqual(
    result.nurNami.map((p) => [p.vorname, p.aktiv]),
    [['Otto', false]]
  );
  assert.deepEqual(
    result.nurCampflow.map((p) => [p.vorname, p.aktiv]),
    [['Neu', true]]
  );
  assert.equal(result.namiLoadedAt, LOADED.nami.toISOString());
});

test('a leave in only one list is a difference of the status', () => {
  const result = gleicheAb(
    [nami(1, 'Anna', 'Muster', { status: 'Inaktiv', austritt: '2025-12-31' })],
    [campflow('per_A', 'Anna', 'Muster')],
    TODAY,
    LOADED
  );
  const status = result.paare[0].felder.find((f) => f.feld === 'status');
  assert.deepEqual(
    [status?.nami, status?.campflow, status?.gleich],
    ['Ausgetreten', 'Mitglied', false]
  );
});

test('a leave later than today still counts as member in CampFlow', () => {
  const result = gleicheAb(
    [nami(1, 'Anna', 'Muster')],
    [campflow('per_A', 'Anna', 'Muster', { leave_date: '2026-12-31' })],
    TODAY,
    LOADED
  );
  const felder = Object.fromEntries(result.paare[0].felder.map((f) => [f.feld, f]));
  assert.equal(felder.status.gleich, true);
  // The planned leave is shown and is a difference, as NaMi has none
  assert.deepEqual([felder.austritt.nami, felder.austritt.campflow], ['', '31.12.2026']);
  assert.equal(felder.austritt.gleich, false);
});

test('a leave date missing in one list is a difference, also when both have left', () => {
  const result = gleicheAb(
    [nami(1, 'Anna', 'Muster', { status: 'Inaktiv', austritt: null })],
    [campflow('per_A', 'Anna', 'Muster', { leave_date: '2025-12-31' })],
    TODAY,
    LOADED
  );
  const felder = Object.fromEntries(result.paare[0].felder.map((f) => [f.feld, f.gleich]));
  assert.equal(felder.status, true);
  assert.equal(felder.austritt, false);
});

test('an address NaMi could not deliver is neither a difference nor a match', () => {
  const result = gleicheAb(
    [nami(1, 'Anna', 'Muster', { adresse: null })],
    [campflow('per_A', 'Anna', 'Muster', { membership_number: '1' })],
    TODAY,
    LOADED
  );
  const felder = Object.fromEntries(result.paare[0].felder.map((f) => [f.feld, f.gleich]));
  assert.deepEqual([felder.strasse, felder.plz, felder.ort], [null, null, null]);
  assert.equal(
    result.paare[0].felder.some((f) => f.gleich === false),
    false
  );
});

test('phone numbers and streets are compared without their spelling', () => {
  assert.equal(telefonKey('+49 (8063) 12-345'), telefonKey('08063/12345'));
  assert.equal(telefonKey('0049 176 1234'), '0176 1234'.replace(/\D/g, ''));
  assert.equal(telefonKey('+49 (0)8063 12345'), telefonKey('08063 12345'));
  assert.equal(telefonKey('0049 (0)8063 12345'), telefonKey('08063 12345'));
  assert.equal(strasseKey('Hauptstr. 3'), strasseKey('Hauptstrasse 3'));
  assert.notEqual(strasseKey('Hauptstr. 3'), strasseKey('Hauptstraße 5'));
});

test('someone who joins CampFlow later is no member yet', () => {
  const result = gleicheAb(
    [nami(1, 'Anna', 'Muster')],
    [campflow('per_A', 'Anna', 'Muster', { membership_number: '1', join_date: '2026-11-19' })],
    TODAY,
    LOADED
  );
  const status = result.paare[0].felder.find((f) => f.feld === 'status');
  assert.deepEqual(
    [status?.nami, status?.campflow, status?.gleich],
    ['Mitglied', 'Tritt am 19.11.2026 ein', false]
  );
  // Still shown while former members are hidden
  assert.equal(result.paare[0].campflow.aktiv, true);
});

test('without first names, last name and birthday only link a pair to be checked', () => {
  const result = gleicheAb(
    [nami(1, '', 'Berger', { mitgliedsnummer: '' })],
    [campflow('per_B', '', 'Berger')],
    TODAY,
    LOADED
  );
  assert.equal(result.paare[0].verbindung, 'geburtsdatum');
});
