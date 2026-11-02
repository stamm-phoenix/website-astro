import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filterSchnupper,
  gruppenstundeText,
  stufeFuerAlter,
  terminText,
  validateSchnupperAnfrage,
} from '../src/lib/schnupper';
import type { StaffSchnupperAnfrage } from '../src/lib/schnupper';

const GRUPPENSTUNDEN = [
  {
    stufe: 'Wölflinge',
    weekday: 'Freitags',
    time: '16:00 – 17:30 Uhr',
    location: 'Pfarrheim Feldkirchen',
  },
  { stufe: 'Rover', weekday: 'Dienstags', time: '19:30 – 21:00 Uhr', location: '' },
];

describe('Schnupperanfragen', () => {
  test('the form suggests the Stufe of the age', () => {
    assert.deepEqual([7, 10, 13, 16].map(stufeFuerAlter), [
      'woelflinge',
      'jupfis',
      'pfadis',
      'rover',
    ]);
  });

  test('the browser runs the same check as the API', () => {
    const { anfrage, errors } = validateSchnupperAnfrage({
      alter: '8',
      stufe: 'woelflinge',
      name: 'Erika',
      email: 'erika@example.test',
      wunschzeit: 'Freitag',
    });
    assert.deepEqual(errors, {});
    assert.equal(anfrage?.alter, 8);
    assert.ok('wunschzeit' in validateSchnupperAnfrage({}).errors);
  });

  test('the Gruppenstunde of the chosen Stufe is named with its place', () => {
    assert.equal(
      gruppenstundeText(GRUPPENSTUNDEN, 'Wölflinge'),
      'Freitags, 16:00 – 17:30 Uhr · Pfarrheim Feldkirchen'
    );
    assert.equal(gruppenstundeText(GRUPPENSTUNDEN, 'Rover'), 'Dienstags, 19:30 – 21:00 Uhr');
    assert.equal(gruppenstundeText(GRUPPENSTUNDEN, 'Pfadfinder'), null);
  });

  test('a confirmed date reads with weekday and time', () => {
    assert.equal(terminText({ datum: '2099-03-10', zeit: '17:30' }), 'Di., 10.03.2099, 17:30 Uhr');
  });

  test('the filter keeps the requests of one state', () => {
    const items = [{ status: 'offen' }, { status: 'abgesagt' }] as StaffSchnupperAnfrage[];
    assert.equal(filterSchnupper(items, 'offen').length, 1);
    assert.equal(filterSchnupper(items, 'alle').length, 2);
  });
});
