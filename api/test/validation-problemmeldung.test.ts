import assert from 'node:assert/strict';
import test from 'node:test';
import { AzureOpenAiError } from '../lib/azure-openai';
import { PROBLEM_MAX_LENGTH, PROBLEM_VERDICTS } from '../lib/problemmeldung-model';
import { parseProblemAssessment } from '../lib/problemmeldung-ki';
import { validateProblemDraft } from '../lib/problemmeldung-senden';
import { problemDiscardSchema } from '../lib/problemmeldung-schema';
import { ValidationError } from '../lib/validation/errors';
import { parseWith } from '../lib/validation/zod';

function draftFields(body: Record<string, unknown> | null): Record<string, string> {
  try {
    validateProblemDraft(body);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

/** A text of exactly `length` characters that the cleaning leaves alone. */
function words(length: number): string {
  return `${'ab '.repeat(length).slice(0, length - 1)}z`;
}

const TITLE_TOO_LONG = `Der Titel darf höchstens ${PROBLEM_MAX_LENGTH.title} Zeichen lang sein.`;
const BODY_TOO_LONG = `Die Beschreibung darf höchstens ${PROBLEM_MAX_LENGTH.body} Zeichen lang sein.`;

test('a draft is cleaned: one-line title, text with line breaks, known label', () => {
  assert.deepEqual(
    validateProblemDraft({
      title: '  Beleg   Upload\n schlägt fehl ',
      body: ' Zeile eins\r\nZeile zwei token=geheim ',
      label: 'enhancement',
      extra: 'ignored',
    }),
    {
      title: 'Beleg Upload schlägt fehl',
      body: 'Zeile eins\nZeile zwei token: [entfernt]',
      label: 'enhancement',
    }
  );
});

test('an empty text of the draft is allowed, an empty title is not', () => {
  assert.equal(validateProblemDraft({ title: 'T', body: '', label: 'bug' }).body, '');
  assert.equal(validateProblemDraft({ title: 'T', label: 'bug' }).body, '');
  assert.equal(validateProblemDraft({ title: 'T', body: 5, label: 'bug' }).body, '');
  for (const title of ['', '   ', undefined, null, 5, ['x']]) {
    assert.deepEqual(draftFields({ title, body: 'x', label: 'bug' }), {
      title: 'Bitte gib einen Titel an.',
    });
  }
});

test('a draft without a known label is refused', () => {
  for (const label of [undefined, '', 'urgent', 5, null]) {
    assert.deepEqual(draftFields({ title: 'T', body: 'x', label }), {
      label: 'Bitte wähle ein Label.',
    });
  }
});

test('a missing or empty body of the request reports title and label', () => {
  const expected = { title: 'Bitte gib einen Titel an.', label: 'Bitte wähle ein Label.' };
  assert.deepEqual(draftFields(null), expected);
  assert.deepEqual(draftFields({}), expected);
});

test('the title and the text count after cleaning and are refused, not cut', () => {
  const longTitle = `${'a '.repeat(95)}token=x`;
  assert.ok(longTitle.length <= PROBLEM_MAX_LENGTH.title);
  assert.deepEqual(draftFields({ title: longTitle, body: 'x', label: 'bug' }), {
    title: TITLE_TOO_LONG,
  });
  assert.equal(
    validateProblemDraft({ title: words(200), body: 'x', label: 'bug' }).title.length,
    200
  );
  assert.deepEqual(draftFields({ title: words(201), body: 'x', label: 'bug' }), {
    title: TITLE_TOO_LONG,
  });
  const body = words(PROBLEM_MAX_LENGTH.body);
  assert.equal(validateProblemDraft({ title: 'T', body, label: 'bug' }).body, body);
  assert.deepEqual(draftFields({ title: 'T', body: `${body}b`, label: 'bug' }), {
    body: BODY_TOO_LONG,
  });
});

test('a text far beyond the limit is refused before it is cleaned', () => {
  assert.equal(draftFields({ title: words(601), body: 'x', label: 'bug' }).title, TITLE_TOO_LONG);
  assert.equal(draftFields({ title: 'T', body: words(16001), label: 'bug' }).body, BODY_TOO_LONG);
  const both = draftFields({
    title: words(601),
    body: words(16001),
    label: 'bug',
  });
  assert.deepEqual(both, { title: TITLE_TOO_LONG, body: BODY_TOO_LONG });
  const started = Date.now();
  draftFields({ title: 'a?'.repeat(500_000), body: 'a/b?'.repeat(500_000), label: 'bug' });
  assert.ok(Date.now() - started < 1000);
});

const ANSWER = {
  verdict: 'plausibel',
  reason: ' Konkret. ',
  title: 'Beleg-Upload  schlägt fehl',
  summary: 'Das Hochladen schlägt fehl.',
  steps: '1. Beleg wählen',
  expected: 'Unbekannt.',
  actual: 'Fehlermeldung.',
  label: 'bug',
};

test('an answer of the model becomes the issue text, cleaned', () => {
  const assessment = parseProblemAssessment({
    ...ANSWER,
    summary: 'Mail an a@b.de und token=x',
    x: 1,
  });
  assert.deepEqual(assessment, {
    verdict: 'plausibel',
    reason: 'Konkret.',
    title: 'Beleg-Upload schlägt fehl',
    body: [
      '## Zusammenfassung\n\nMail an [E-Mail entfernt] und token: [entfernt]',
      '## Schritte zur Reproduktion\n\n1. Beleg wählen',
      '## Erwartetes Verhalten\n\nUnbekannt.',
      '## Tatsächliches Verhalten\n\nFehlermeldung.',
    ].join('\n\n'),
    label: 'bug',
  });
});

test('the parts of an answer are cut to their limits, not refused', () => {
  const long = parseProblemAssessment({
    ...ANSWER,
    reason: words(600),
    title: words(300),
    summary: words(2000),
    steps: words(2000),
    expected: words(2000),
    actual: words(2000),
  });
  assert.equal(long.reason.length, 500);
  assert.equal(long.title.length, PROBLEM_MAX_LENGTH.title);
  const summary = /## Zusammenfassung\n\n(.*)\n\n## Schritte/s.exec(long.body)?.[1] ?? '';
  assert.ok(summary.length >= 1499 && summary.length <= 1500);
  assert.ok(long.body.length <= PROBLEM_MAX_LENGTH.body);
});

test('every verdict is accepted, anything unexpected in an answer is an error', () => {
  for (const verdict of PROBLEM_VERDICTS) {
    assert.equal(parseProblemAssessment({ ...ANSWER, verdict }).verdict, verdict);
  }
  const broken: unknown[] = [
    null,
    undefined,
    'text',
    [],
    {},
    { ...ANSWER, verdict: 'veroeffentlichen' },
    { ...ANSWER, verdict: undefined },
    { ...ANSWER, label: 'urgent' },
    { ...ANSWER, label: undefined },
    ...['reason', 'title', 'summary', 'steps', 'expected', 'actual'].flatMap((field) => [
      { ...ANSWER, [field]: '' },
      { ...ANSWER, [field]: '   ' },
      { ...ANSWER, [field]: 5 },
      { ...ANSWER, [field]: null },
      { ...ANSWER, [field]: undefined },
    ]),
  ];
  for (const answer of broken) {
    assert.throws(
      () => parseProblemAssessment(answer),
      (error: unknown) =>
        error instanceof AzureOpenAiError &&
        error.message === 'The answer of the model does not match the schema'
    );
  }
});

test('the reason of a discard is trimmed and cut, and never refused', () => {
  const reason = (body: unknown): string => parseWith(problemDiscardSchema, body).reason;
  assert.equal(reason({ reason: '  Kein Fehler.  ' }), 'Kein Fehler.');
  assert.equal(reason({ reason: 'x'.repeat(600) }).length, PROBLEM_MAX_LENGTH.discardReason);
  for (const body of [null, {}, { reason: 5 }, { reason: null }, []])
    assert.equal(reason(body), '');
});
