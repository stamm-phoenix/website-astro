import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DOMParser } from 'linkedom';
import { setServerHtmlParser } from '../src/lib/html';
import { createQuestionIndex, searchQuestions, suggestQuestions } from '../src/lib/qaSearch';

setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);
const questions = [
  {
    id: '1',
    category: 'Mitmachen',
    question: 'Wie geht Schnuppern?',
    answer: '<p>Drei Wochen</p><p>kostenlos &amp; unverbindlich.</p>',
  },
  {
    id: '2',
    category: 'Ausrüstung',
    question: 'Was mitnehmen?',
    answer: '<p>Schlafsack und <strong>Kluft</strong>.</p>',
  },
  {
    id: '3',
    category: 'Kosten',
    question: 'Mitgliedsbeitrag?',
    answer: '<p>Ermäßigung möglich.</p>',
  },
];
const index = createQuestionIndex(questions);
const ids = (items: typeof questions): string[] => items.map((item) => item.id);

describe('FAQ text search', () => {
  test('matches words across question, visible answer and category, regardless of case or accents', () => {
    assert.deepEqual(ids(searchQuestions(index, 'SCHNUPPERN kostenlos')), ['1']);
    assert.deepEqual(ids(searchQuestions(index, 'ausrustung kluft')), ['2']);
    assert.deepEqual(ids(searchQuestions(index, 'ermassigung')), ['3']);
    assert.deepEqual(ids(searchQuestions(index, 'wochen kostenlos')), ['1']);
  });
  test('requires all terms and preserves the full list for an empty query', () => {
    assert.deepEqual(searchQuestions(index, 'Kluft kostenlos'), []);
    assert.deepEqual(searchQuestions(index, 'Meerjungfrau'), []);
    assert.deepEqual(ids(searchQuestions(index, '  ')), ['1', '2', '3']);
  });
  test('does not match HTML attributes or tags', () => {
    assert.deepEqual(searchQuestions(index, 'strong'), []);
  });
});

describe('contact suggestions', () => {
  test('ignores common words and finds useful terms in a whole message', () => {
    assert.deepEqual(suggestQuestions(index, 'Wie kann ich euch etwas fragen?'), []);
    assert.deepEqual(
      ids(suggestQuestions(index, 'Hallo, brauche ich eine Kluft zum Schnuppern?')),
      ['1', '2']
    );
  });
  test('ranks by matched terms, caps suggestions and hides them for empty input', () => {
    assert.deepEqual(ids(suggestQuestions(index, 'kostenlos Kluft Ausrüstung', 1)), ['2']);
    assert.deepEqual(suggestQuestions(index, ''), []);
  });
});
