import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nachFehler,
  schritt,
  sendewert,
  uebernommen,
  vergleichswert,
} from '../src/components/essensplanung/gerichtKopf.ts';

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

test('input equal to what someone else saved meanwhile is nothing to decide', () => {
  assert.equal(schritt('Kürbissuppe', 'Suppe', 'Kürbissuppe', ohne), 'nichts');
});

test('empty rows of links are no input and stay in the form', () => {
  const links = [
    { titel: 'Rezept', url: 'https://example.org' },
    { titel: '', url: ' ' },
  ];
  assert.deepEqual(vergleichswert('links', links), [links[0]]);
  assert.equal(schritt(vergleichswert('links', links), [links[0]], [links[0]], ohne), 'nichts');
  assert.deepEqual(uebernommen('links', [links[0]], links), links);
  assert.equal(uebernommen('notiz', 'neu', 'alt'), 'neu');
});

test('people go as a number, links without empty rows with their form rows', () => {
  const kopf = {
    name: 'Chili',
    personen: ' 12 ',
    anleitung: '',
    notiz: '',
    werkzeuge: [],
    links: [
      { titel: '', url: '' },
      { titel: 'Original', url: '' },
    ],
  };
  assert.deepEqual(sendewert('personen', kopf).wert, 12);
  assert.deepEqual(sendewert('personen', { ...kopf, personen: '' }).wert, null);
  assert.deepEqual(sendewert('personen', { ...kopf, personen: '1,5' }).wert, '1,5');
  assert.deepEqual(sendewert('links', kopf), { wert: [kopf.links[1]], linkIndex: [1] });
});
