import assert from 'node:assert/strict';
import test from 'node:test';
import {
  erfolgText,
  vereint,
  werkzeugeFehler,
} from '../src/components/essensplanung/rezeptVorschau.ts';

/** Taking over a dish the AI wrote: the tools added and the message afterwards. */

test('new tools are added to the ones of the dish without doubles', () => {
  assert.deepEqual(vereint(['Kelle', 'Großer Topf'], ['großer topf', 'Pfanne', 'PFANNE']), [
    'Kelle',
    'Großer Topf',
    'Pfanne',
  ]);
  assert.deepEqual(vereint([], []), []);
});

test('too many tools are named, never cut off', () => {
  const bisher = Array.from({ length: 29 }, (_, i) => `Werkzeug ${i}`);
  const alle = vereint(bisher, ['Sieb', 'Pfanne', 'Kelle']);
  assert.equal(alle.length, 32);
  assert.equal(
    werkzeugeFehler(alle.length),
    'Ein Gericht hat höchstens 30 Werkzeuge. Entferne hier 2 oder übernimm keine.'
  );
  assert.equal(
    werkzeugeFehler(31),
    'Ein Gericht hat höchstens 30 Werkzeuge. Entferne hier eines oder übernimm keine.'
  );
  assert.equal(werkzeugeFehler(30), null);
  assert.equal(werkzeugeFehler(0), null);
});

test('the message names what was taken over', () => {
  assert.equal(
    erfolgText('Nudelpfanne', 6, { anleitung: '1. Kochen.', werkzeuge: ['Topf'] }, 10),
    '6 Zutaten, Anleitung und Werkzeuge übernommen, Nudelpfanne ist jetzt für 10 Personen.'
  );
  assert.equal(erfolgText('Chili', 1, undefined, undefined), 'Eine Zutat übernommen.');
  assert.equal(
    erfolgText('Chili', 0, { anleitung: 'Kochen.' }, undefined),
    'Anleitung übernommen.'
  );
  assert.equal(
    erfolgText('Chili', 3, { werkzeuge: ['Topf'] }, undefined),
    '3 Zutaten und Werkzeuge übernommen.'
  );
});
