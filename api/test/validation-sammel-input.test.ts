import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  isSammelEtag,
  validateSammelArchived,
  validateSammelCreationKey,
  validateSammelInviteAction,
  validateSammelItemStatus,
} from '../lib/validation/sammel-input';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('only a concrete quoted version is an ETag', () => {
  for (const value of ['"1"', 'W/"abc"', '"a b"'] as const) assert.equal(isSammelEtag(value), true);
  for (const value of ['*', '"', '""', 'W/', '1', '"a\nb"', ' "1"', undefined, null, 1, {}])
    assert.equal(isSammelEtag(value), false, String(value));
});

test('the creation key is a 36 character ID', () => {
  const key = 'c0a8c20c-5a24-49ae-bc37-b5f13309908c';
  assert.equal(validateSammelCreationKey({ creationKey: key }), key);
  for (const creationKey of [undefined, null, 5, '', key.toUpperCase(), `${key}0`, key.slice(1)])
    assert.deepEqual(
      fields(() => validateSammelCreationKey({ creationKey })),
      {
        creationKey: 'Bitte öffne das Formular erneut.',
      }
    );
});

test('the archive status is a boolean', () => {
  assert.equal(validateSammelArchived({ archived: true }), true);
  assert.equal(validateSammelArchived({ archived: false }), false);
  for (const archived of [undefined, null, 'true', 1])
    assert.deepEqual(
      fields(() => validateSammelArchived({ archived })),
      {
        archived: 'Bitte gib den Archivstatus an.',
      }
    );
});

test('an item status names an article of the order and a boolean', () => {
  assert.deepEqual(validateSammelItemStatus({ index: 2, excluded: false, x: 1 }, 3), {
    index: 2,
    excluded: false,
  });
  const form = { form: 'Bitte wähle einen Artikel und seinen Bestellstatus.' };
  for (const body of [
    { index: 3, excluded: true },
    { index: -1, excluded: true },
    { index: 1.5, excluded: true },
    { index: '1', excluded: true },
    { excluded: true },
    { index: 0 },
    { index: 0, excluded: 'true' },
    { index: 0, excluded: null },
  ])
    assert.deepEqual(
      fields(() => validateSammelItemStatus(body, 3)),
      form,
      JSON.stringify(body)
    );
  assert.deepEqual(
    fields(() => validateSammelItemStatus({ index: 0, excluded: true }, 0)),
    form
  );
});

test('the invitation action is preview or send', () => {
  assert.equal(validateSammelInviteAction({ action: 'preview' }), 'preview');
  assert.equal(validateSammelInviteAction({ action: 'send' }), 'send');
  for (const action of [undefined, null, 'Send', 'delete', 1])
    assert.deepEqual(
      fields(() => validateSammelInviteAction({ action })),
      {
        form: 'Bitte wähle Vorschau oder Versand.',
      }
    );
});
