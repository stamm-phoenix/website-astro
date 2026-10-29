import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterVorschlaege, trefferTeile } from '../src/lib/vorschlaege';

const AKTIONEN = ['Sommerlager', 'Gruppenstunde Wölflinge', 'Pfingstlager', 'Sommerfest'].map(
  (value) => ({ value })
);
const values = (query: string, max = 8): string[] =>
  filterVorschlaege(AKTIONEN, query, max).matches.map((v) => v.value);

test('suggestions match the typed text anywhere, ignoring case', () => {
  assert.deepEqual(values('LAGER'), ['Sommerlager', 'Pfingstlager']);
  assert.deepEqual(values('wölf'), ['Gruppenstunde Wölflinge']);
});

test('an empty field offers everything up to the limit and counts the rest', () => {
  const result = filterVorschlaege(AKTIONEN, '  ', 3);
  assert.equal(result.matches.length, 3);
  assert.equal(result.total, 4);
});

test('suggestions also match their extra text and repeat no key', () => {
  const people = [
    { value: 'Anna', search: 'anna@stamm-phoenix.de', key: 'a' },
    { value: 'Anna', search: 'anna@stamm-phoenix.de', key: 'a' },
    { value: 'Bea', search: 'bea@stamm-phoenix.de', key: 'b' },
  ];
  assert.deepEqual(
    filterVorschlaege(people, 'bea@', 8).matches.map((v) => v.key),
    ['b']
  );
  assert.equal(filterVorschlaege(people, '', 8).total, 2);
});

test('the match is marked in the original spelling', () => {
  assert.deepEqual(trefferTeile('Sommerlager', 'LAGER'), [
    { text: 'Sommer', hit: false },
    { text: 'lager', hit: true },
  ]);
  assert.deepEqual(trefferTeile('Sommerlager', ''), [{ text: 'Sommerlager', hit: false }]);
  assert.deepEqual(trefferTeile('Sommerlager', 'fest'), [{ text: 'Sommerlager', hit: false }]);
});

test('the best fitting suggestions come first, headings kept together', () => {
  const zutaten = [
    { value: 'Vollmilch', gruppe: 'In dieser Planung' },
    { value: 'Öl', gruppe: 'In dieser Planung' },
    { value: 'Karfiol', gruppe: 'Zutatenliste' },
    { value: 'Oliven', gruppe: 'Zutatenliste' },
    { value: 'Olivenöl', gruppe: 'Zutatenliste' },
    { value: 'Rote Oliven', gruppe: 'Zutatenliste' },
  ];
  assert.deepEqual(
    filterVorschlaege(zutaten, 'ol', 8).matches.map((v) => v.value),
    ['Oliven', 'Olivenöl', 'Rote Oliven', 'Karfiol', 'Vollmilch']
  );
  // Without typed text the order stays as given
  assert.deepEqual(
    filterVorschlaege(zutaten, '', 2).matches.map((v) => v.value),
    ['Vollmilch', 'Öl']
  );
  assert.deepEqual(values('sommer'), ['Sommerlager', 'Sommerfest']);
});
