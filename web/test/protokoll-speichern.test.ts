import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/lib/apiError';
import {
  RETRY_MS,
  SAVE_MAX_WAIT_MS,
  classifySaveError,
  retryDelay,
  saveStatusText,
  saveWait,
} from '../src/lib/protokollSpeichern';

/** What the Protokoll editor does after a failed save, and the waits of the automatic saving. */

test('no connection, a timeout and server errors are tried again', () => {
  assert.deepEqual(classifySaveError(new TypeError('Failed to fetch')), { kind: 'retry' });
  assert.deepEqual(classifySaveError(new ApiError(0, 'Zeitüberschreitung')), { kind: 'retry' });
  assert.deepEqual(classifySaveError(new ApiError(500, 'Fehler')), { kind: 'retry' });
  assert.deepEqual(classifySaveError(new ApiError(503, 'Fehler')), { kind: 'retry' });
});

test('a taken lock and a conflict end the writing', () => {
  assert.deepEqual(classifySaveError(new ApiError(423, 'Gesperrt')), { kind: 'lostLock' });
  assert.deepEqual(classifySaveError(new ApiError(409, 'Geändert', { code: 'CONFLICT' })), {
    kind: 'lostLock',
  });
});

test('minutes that can no longer be written end the writing with the reason of the server', () => {
  assert.deepEqual(
    classifySaveError(new ApiError(409, 'Liegt zur Prüfung.', { code: 'NOT_EDITABLE' })),
    { kind: 'notEditable', message: 'Liegt zur Prüfung.' }
  );
});

test('deleted minutes, an expired login and rejected input are shown and not retried', () => {
  assert.deepEqual(classifySaveError(new ApiError(404, 'Nicht gefunden')), {
    kind: 'fatal',
    message: 'Das Protokoll wurde gelöscht. Deine Änderungen sind auf diesem Gerät gesichert.',
  });
  assert.deepEqual(classifySaveError(new ApiError(401, 'Abgelaufen')), {
    kind: 'fatal',
    message: 'Bitte neu anmelden. Deine Änderungen sind auf diesem Gerät gesichert.',
  });
  const invalid = new ApiError(400, 'Ungültig', {
    fields: { title: 'Titel zu lang.', date: 'Datum fehlt.' },
  });
  assert.deepEqual(classifySaveError(invalid), {
    kind: 'fatal',
    message: 'Titel zu lang. Datum fehlt.',
  });
  // A conflict of another kind is no lost lock
  assert.deepEqual(classifySaveError(new ApiError(409, 'Anders', { code: 'OTHER' })), {
    kind: 'fatal',
    message: 'Anders',
  });
});

test('a save waits for the quiet time, but never longer than the longest wait', () => {
  assert.equal(saveWait(1000, 0, 0), 1000);
  assert.equal(saveWait(1000, 0, SAVE_MAX_WAIT_MS - 300), 300);
  assert.equal(saveWait(1000, 0, SAVE_MAX_WAIT_MS + 10), 0);
});

test('the waits between attempts grow and stay at the last one', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelay), [
    ...RETRY_MS,
    RETRY_MS.at(-1),
    RETRY_MS.at(-1),
  ]);
});

test('the status bar names the state of the saving', () => {
  assert.equal(saveStatusText('gespeichert', null, null), 'Gespeichert');
  assert.match(saveStatusText('gespeichert', '2026-11-13T09:05:00Z', null), /^Gespeichert um /);
  assert.equal(
    saveStatusText('ungespeichert', null, null),
    'Änderungen werden gleich gespeichert …'
  );
  assert.equal(saveStatusText('speichert', null, null), 'Speichert …');
  assert.equal(
    saveStatusText('offline', null, null),
    'Offline – Änderungen sind auf diesem Gerät gesichert'
  );
  assert.equal(saveStatusText('fehler', null, 'Bitte neu anmelden.'), 'Bitte neu anmelden.');
  assert.equal(saveStatusText('fehler', null, null), 'Nicht gespeichert');
});
