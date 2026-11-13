import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessment, assessmentFailure, PROBLEM_STATUS } from '../src/lib/problemAnzeige';
import type { StaffProblemMeldung } from '../src/lib/problemMelden';

const withAi = (ai: Partial<StaffProblemMeldung['ai']>): StaffProblemMeldung =>
  ({
    ai: { status: 'ausstehend', verdict: null, error: '', ...ai },
  }) as unknown as StaffProblemMeldung;

test('a finished assessment is labelled by its verdict, other states by their status', () => {
  assert.deepEqual(assessment(withAi({ status: 'fertig', verdict: 'plausibel' })), {
    label: 'Einschätzung: plausibel',
    tone: 'success',
  });
  assert.equal(assessment(withAi({ status: 'fertig', verdict: 'spam' }))?.tone, 'danger');
  assert.equal(assessment(withAi({ status: 'fehler' }))?.label, 'Einschätzung fehlgeschlagen');
  assert.equal(
    assessment(withAi({ status: 'nicht_eingerichtet' }))?.label,
    'Keine Einschätzung eingerichtet'
  );
  assert.equal(assessment(withAi({}))?.label, 'Einschätzung ausstehend');
});

test('the technical error of an assessment is told in words', () => {
  assert.equal(assessmentFailure('request timed out'), 'Die Antwort kam nicht rechtzeitig');
  assert.equal(
    assessmentFailure('Tageslimit erreicht'),
    'Das Tageslimit für Einschätzungen ist erreicht'
  );
  assert.equal(assessmentFailure('HTTP 429'), 'Gerade sind zu viele Anfragen unterwegs');
  assert.equal(assessmentFailure('HTTP 500'), 'Der Dienst antwortete mit Fehler 500');
  assert.equal(assessmentFailure('???'), 'Die Antwort war nicht brauchbar');
});

test('every status has a label', () => {
  assert.equal(PROBLEM_STATUS.uebermittelt.label, 'An GitHub gesendet');
});
