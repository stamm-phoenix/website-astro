import assert from 'node:assert/strict';
import test from 'node:test';
import { nachFehler, schritt } from '../src/components/essensplanung/gerichtKopf.ts';

const ohne = { konflikt: false, bewusst: false };

test('input equal to its basis saves nothing, also with a warning standing', () => {
  assert.equal(schritt('Topf', 'Topf', 'Topf', ohne), 'nichts');
  assert.equal(schritt('Pfanne', 'Pfanne', 'Pfanne', { konflikt: true, bewusst: false }), 'nichts');
});

test('input on the current state is sent', () => {
  assert.equal(schritt(['Topf', 'Kelle'], ['Topf'], ['Topf'], ohne), 'senden');
});

test('a change of others to the same field waits for the decision', () => {
  assert.equal(schritt('Meine Notiz', 'alt', 'deren Notiz', ohne), 'konflikt');
  assert.equal(
    schritt('Meine Notiz', 'deren Notiz', 'deren Notiz', { konflikt: true, bewusst: false }),
    'konflikt'
  );
});

test('„Trotzdem speichern“ sends over it', () => {
  assert.equal(
    schritt('Meine Notiz', 'alt', 'deren Notiz', { konflikt: true, bewusst: true }),
    'senden'
  );
});

test('a new version from a change to another field sends the field once more', () => {
  assert.equal(nachFehler('Notiz', 'Notiz', '"1"', '"2"'), 'nochmal');
});

test('a refused save after a change to the same field is a conflict', () => {
  assert.equal(nachFehler('deren Notiz', 'Notiz', '"1"', '"2"'), 'konflikt');
});

test('without a new version the input stays with its error', () => {
  assert.equal(nachFehler('Notiz', 'Notiz', '"1"', '"1"'), 'fehler');
});
