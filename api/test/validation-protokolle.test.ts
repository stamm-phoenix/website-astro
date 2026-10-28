import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTaskDecision, validateTaskDone } from '../lib/validation/aufgaben-request';
import { ValidationError } from '../lib/validation/errors';
import {
  validateProtokollEditorAufgabe,
  validateProtokollEditorReview,
} from '../lib/validation/protokoll-editor';
import {
  readProtokollNote,
  validateProtokollAction,
  validateProtokollCreate,
  validateProtokollVersand,
} from '../lib/validation/protokolle';

const TOKEN = 'tab-a-0123456789abcdef';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('minutes from the template: title becomes part of the file name', () => {
  assert.deepEqual(validateProtokollCreate({ title: '  Leitenden   runde ', date: '2026-10-14' }), {
    title: 'Leitenden runde',
    date: '2026-10-14',
  });
  const title = 'Bitte einen Titel mit höchstens 80 Zeichen angeben.';
  const date = 'Bitte das Datum der Sitzung angeben.';
  assert.deepEqual(
    fields(() => validateProtokollCreate(null)),
    { title, date }
  );
  assert.deepEqual(
    fields(() => validateProtokollCreate({ title: 5, date: 5 })),
    { title, date }
  );
  assert.deepEqual(
    fields(() => validateProtokollCreate({ title: 'x'.repeat(81), date: '2026-02-30' })),
    { title, date }
  );
  assert.equal(
    validateProtokollCreate({ title: 'x'.repeat(80), date: '2026-10-14' }).title.length,
    80
  );
  for (const bad of [
    'a/b',
    'a:b',
    'a"b',
    'a*b',
    'a<b',
    'a>b',
    'a?b',
    'a\\b',
    'a|b',
    'a#b',
    'a%b',
  ]) {
    assert.deepEqual(
      fields(() => validateProtokollCreate({ title: bad, date: '2026-10-14' })),
      {
        title: 'Der Titel darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %',
      }
    );
  }
  // A title that ends in a dot is fine because the file name ends in „.docx“
  assert.equal(validateProtokollCreate({ title: 'Runde.', date: '2026-10-14' }).title, 'Runde.');
});

test('steps of the minutes: only the known actions pass', () => {
  const actions = ['review', 'approve', 'reject', 'reopen'] as const;
  assert.equal(validateProtokollAction({ action: 'reject', note: 'x' }, actions), 'reject');
  for (const body of [null, {}, { action: 'delete' }, { action: 5 }, [], 'review']) {
    assert.deepEqual(
      fields(() => validateProtokollAction(body, actions)),
      {
        form: 'Unbekannte Aktion.',
      }
    );
  }
});

test('the mailing step and its retry flag', () => {
  assert.deepEqual(validateProtokollVersand({ action: 'send', retry: true }), {
    action: 'send',
    retry: true,
  });
  assert.deepEqual(validateProtokollVersand({ action: 'preview', retry: 'true' }), {
    action: 'preview',
    retry: false,
  });
  assert.deepEqual(
    fields(() => validateProtokollVersand({ action: 'mail' })),
    {
      form: 'Unbekannte Aktion.',
    }
  );
});

test('the note of a rejection is trimmed and cut', () => {
  assert.equal(readProtokollNote({ note: '  zu kurz  ' }), 'zu kurz');
  assert.equal(readProtokollNote({ note: 'x'.repeat(2500) }).length, 2000);
  for (const body of [null, {}, { note: 5 }]) assert.equal(readProtokollNote(body), '');
});

test('a step of the editor review', () => {
  assert.deepEqual(
    validateProtokollEditorReview({
      action: 'approve',
      token: TOKEN,
      ownConfirmed: true,
      note: ' Grund ',
    }),
    { action: 'approve', token: TOKEN, ownConfirmed: true, note: ' Grund ' }
  );
  assert.deepEqual(
    validateProtokollEditorReview({ action: 'review', token: 'kurz', ownConfirmed: 1 }),
    {
      action: 'review',
      token: null,
      ownConfirmed: false,
      note: '',
    }
  );
  assert.deepEqual(
    fields(() => validateProtokollEditorReview({ action: 'reopen' })),
    {
      form: 'Unbekannte Aktion.',
    }
  );
});

test('ticking an open task off in the meeting', () => {
  assert.equal(validateProtokollEditorAufgabe({ erledigt: false }), false);
  for (const body of [null, {}, { erledigt: 'ja' }]) {
    assert.deepEqual(
      fields(() => validateProtokollEditorAufgabe(body)),
      {
        erledigt: 'Bitte angeben, ob die Aufgabe erledigt ist.',
      }
    );
  }
});

test('tasks: done flag and decision', () => {
  assert.equal(validateTaskDone({ done: true }), true);
  for (const body of [null, {}, { done: 1 }]) {
    assert.deepEqual(
      fields(() => validateTaskDone(body)),
      {
        done: 'Bitte den Erledigt-Status angeben.',
      }
    );
  }
  assert.equal(validateTaskDecision({ action: 'annehmen' }), 'annehmen');
  assert.equal(validateTaskDecision({ action: 'ablehnen' }), 'ablehnen');
  for (const body of [null, {}, { action: 'warten' }]) {
    assert.deepEqual(
      fields(() => validateTaskDecision(body)),
      {
        form: 'Unbekannte Entscheidung.',
      }
    );
  }
});
