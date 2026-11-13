import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { neueMahlzeitPositionen } from '../lib/essen-mahlzeiten-reihenfolge';

/** Renumbering the meals of a day, and the counter of the central lists. */

const tag = [
  { id: 10, position: 1 },
  { id: 11, position: 2 },
  { id: 12, position: 3 },
  { id: 13, position: 4 },
];

test('meals in order keep their positions', () => {
  assert.deepEqual(neueMahlzeitPositionen(tag), []);
  assert.deepEqual(neueMahlzeitPositionen(tag, { id: 12, position: 3 }), []);
});

test('a gap after a deletion is closed, ties are broken by the id', () => {
  assert.deepEqual(
    neueMahlzeitPositionen([
      { id: 10, position: 1 },
      { id: 12, position: 3 },
      { id: 13, position: 4 },
    ]),
    [
      { id: 12, position: 2 },
      { id: 13, position: 3 },
    ]
  );
  assert.deepEqual(
    neueMahlzeitPositionen([
      { id: 21, position: 1 },
      { id: 20, position: 1 },
    ]),
    [{ id: 21, position: 2 }]
  );
});

test('a moved meal takes its 1-based position and the others close up around it', () => {
  assert.deepEqual(neueMahlzeitPositionen(tag, { id: 13, position: 1 }), [
    { id: 13, position: 1 },
    { id: 10, position: 2 },
    { id: 11, position: 3 },
    { id: 12, position: 4 },
  ]);
  assert.deepEqual(neueMahlzeitPositionen(tag, { id: 10, position: 3 }), [
    { id: 11, position: 1 },
    { id: 12, position: 2 },
    { id: 10, position: 3 },
  ]);
});

test('a position outside the day is clamped to the first or the last place', () => {
  assert.deepEqual(neueMahlzeitPositionen(tag, { id: 11, position: 99 }), [
    { id: 12, position: 2 },
    { id: 13, position: 3 },
    { id: 11, position: 4 },
  ]);
  assert.deepEqual(neueMahlzeitPositionen(tag, { id: 12, position: -5 }), [
    { id: 12, position: 1 },
    { id: 10, position: 2 },
    { id: 11, position: 3 },
  ]);
});

test('a new meal that was appended moves to its place and shifts the rest', () => {
  assert.deepEqual(
    neueMahlzeitPositionen(
      [
        { id: 1, position: 1 },
        { id: 2, position: 2 },
        { id: 3, position: 3 },
      ],
      { id: 3, position: 2 }
    ),
    [
      { id: 3, position: 2 },
      { id: 2, position: 3 },
    ]
  );
});

test('every write to the central lists bumps the catalog counter', () => {
  const lib = join(__dirname, '../lib');
  const schreibt =
    /(?:insertInto|updateTable|deleteFrom)\(\s*'essen\.(?:zutat|kategorie|unvertraeglichkeit)'/;
  const ohneZaehler = readdirSync(lib)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => {
      const source = readFileSync(join(lib, name), 'utf8');
      return schreibt.test(source) && !source.includes('katalogGeaendert(');
    });
  assert.deepEqual(ohneZaehler, []);
});
