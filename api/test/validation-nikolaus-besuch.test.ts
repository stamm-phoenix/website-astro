import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MEETING_NOTES_LENGTH,
  validateCancelled,
  validateChildStatus,
  validateGuestName,
  validateMeetingDeletion,
  validateMeetingNotes,
} from '../lib/validation/nikolaus-besuch';
import { ValidationError } from '../lib/validation/errors';

function fields(action: () => unknown): Record<string, string> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const NO_VERSION = 'Die Version des Termins fehlt. Bitte neu laden.';

test('the notes of a Gruppenstunde keep line breaks and tidy the spaces', () => {
  assert.deepEqual(
    validateMeetingNotes({ notes: '  Zeile  1\r\n\r\n\r\n\r\nZeile\t2 \r', etag: '"1"' }),
    {
      notes: 'Zeile 1\n\nZeile 2',
      etag: '"1"',
    }
  );
  assert.deepEqual(validateMeetingNotes({ notes: '', etag: null }), { notes: '', etag: null });
  assert.equal(
    validateMeetingNotes({ notes: 'x'.repeat(MAX_MEETING_NOTES_LENGTH), etag: '' }).etag,
    ''
  );
});

test('the notes of a Gruppenstunde report what is wrong', () => {
  assert.deepEqual(
    fields(() => validateMeetingNotes({ notes: 5, etag: undefined })),
    { notes: 'Der Inhalt ist ungültig.', etag: NO_VERSION }
  );
  assert.deepEqual(
    fields(() => validateMeetingNotes(null)),
    { notes: 'Der Inhalt ist ungültig.', etag: NO_VERSION }
  );
  assert.deepEqual(
    fields(() =>
      validateMeetingNotes({ notes: 'x'.repeat(MAX_MEETING_NOTES_LENGTH + 1), etag: 3 })
    ),
    {
      notes: 'Der Inhalt darf höchstens 2000 Zeichen lang sein.',
      etag: NO_VERSION,
    }
  );
  // The limit counts the tidied text
  assert.equal(
    validateMeetingNotes({ notes: ' ' + 'x'.repeat(MAX_MEETING_NOTES_LENGTH), etag: null }).notes
      .length,
    MAX_MEETING_NOTES_LENGTH
  );
});

test('the attendance of a child is anwesend or entschuldigt', () => {
  assert.equal(validateChildStatus({ status: 'anwesend' }), 'anwesend');
  assert.equal(validateChildStatus({ status: 'entschuldigt' }), 'entschuldigt');
  const invalid = { status: 'Bitte eine gültige Auswahl für die Anwesenheit treffen.' };
  for (const body of [{ status: 'krank' }, { status: 1 }, {}, null]) {
    assert.deepEqual(
      fields(() => validateChildStatus(body)),
      invalid
    );
  }
});

test('a cancelled Gruppenstunde carries the loaded version and the number of entries', () => {
  assert.deepEqual(validateCancelled({ cancelled: true, etag: '"1"', entries: 3 }), {
    cancelled: true,
    etag: '"1"',
    entries: 3,
  });
  assert.deepEqual(validateCancelled({ cancelled: false, etag: null }), {
    cancelled: false,
    etag: null,
    entries: 0,
  });
  assert.equal(validateCancelled({ cancelled: false, etag: null, entries: null }).entries, 0);
  assert.equal(validateCancelled({ cancelled: false, etag: null, entries: 0 }).entries, 0);
});

test('a cancelled Gruppenstunde reports every invalid part', () => {
  assert.deepEqual(
    fields(() => validateCancelled({ cancelled: 'yes', etag: 5, entries: -1 })),
    {
      cancelled: 'Die Angabe „Ausgefallen“ ist ungültig.',
      etag: NO_VERSION,
      entries: 'Die Zahl der Einträge ist ungültig.',
    }
  );
  assert.deepEqual(
    fields(() => validateCancelled(null)),
    { cancelled: 'Die Angabe „Ausgefallen“ ist ungültig.', etag: NO_VERSION }
  );
  for (const entries of [1.5, '2', false, {}]) {
    assert.deepEqual(
      fields(() => validateCancelled({ cancelled: true, etag: null, entries })),
      { entries: 'Die Zahl der Einträge ist ungültig.' }
    );
  }
});

test('the name of a guest is trimmed and required', () => {
  assert.equal(validateGuestName({ name: '  Max   Muster ' }), 'Max Muster');
  assert.deepEqual(
    fields(() => validateGuestName({ name: ' ' })),
    { name: 'Bitte den Namen angeben.' }
  );
  assert.deepEqual(
    fields(() => validateGuestName(null)),
    { name: 'Bitte den Namen angeben.' }
  );
  assert.deepEqual(
    fields(() => validateGuestName({ name: 1 })),
    { name: 'den Namen ist ungültig.' }
  );
  assert.deepEqual(
    fields(() => validateGuestName({ name: 'x'.repeat(101) })),
    { name: 'den Namen darf höchstens 100 Zeichen lang sein.' }
  );
});

test('the attendance shown on deletion is passed on unchanged', () => {
  assert.equal(validateMeetingDeletion({ attendance: ' 3 Kinder ' }), ' 3 Kinder ');
  assert.equal(validateMeetingDeletion({ attendance: '' }), '');
  assert.equal(validateMeetingDeletion({ attendance: 'x'.repeat(100_000) }).length, 100_000);
  const invalid = { attendance: 'Lade die Gruppenstunde neu, bevor du sie löschst.' };
  for (const body of [{ attendance: 'x'.repeat(100_001) }, { attendance: 3 }, {}, null]) {
    assert.deepEqual(
      fields(() => validateMeetingDeletion(body)),
      invalid
    );
  }
});
