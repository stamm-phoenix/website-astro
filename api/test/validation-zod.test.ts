import assert from 'node:assert/strict';
import test from 'node:test';
import { choice, choices, labeledText, lenientObject, parseWith } from '../lib/validation/zod';
import { ValidationError } from '../lib/validation/errors';

const schema = lenientObject({
  name: labeledText('den Namen', 12, true),
  age: labeledText('das Alter', 5),
  stufe: choice('die Stufe', ['Wölflinge', 'Rover']),
  tags: choices('Die Merkmale', ['a', 'b']).default([]),
});
const valid = { name: ' Max   Muster ', stufe: 'Rover' };

function fields(value: unknown): Record<string, string> {
  try {
    parseWith(schema, value);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('labeled text trims, collapses whitespace and defaults a missing value', () => {
  assert.deepEqual(parseWith(schema, valid), {
    name: 'Max Muster',
    age: '',
    stufe: 'Rover',
    tags: [],
  });
  assert.equal(parseWith(schema, { ...valid, age: null }).age, '');
});

test('labeled text reports the same German messages as the old reader', () => {
  assert.deepEqual(fields({ ...valid, name: '  ', age: 5 }), {
    name: 'Bitte den Namen angeben.',
    age: 'das Alter ist ungültig.',
  });
  assert.equal(
    fields({ ...valid, name: 'viel zu langer Name' }).name,
    'den Namen darf höchstens 12 Zeichen lang sein.'
  );
});

test('a body that is no object reports the missing fields', () => {
  for (const body of [null, [], 'text'])
    assert.deepEqual(fields(body), {
      name: 'Bitte den Namen angeben.',
      stufe: 'Bitte eine gültige Auswahl für die Stufe treffen.',
    });
});

test('choices drop duplicates and reject unknown values', () => {
  assert.deepEqual(parseWith(schema, { ...valid, tags: ['a', 'b', 'a'] }).tags, ['a', 'b']);
  assert.equal(fields({ ...valid, tags: ['c'] }).tags, 'Die Merkmale enthält ungültige Werte.');
});
