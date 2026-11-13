import { parseQuestionsAndAnswers } from './types/oeffentlich';
import type { QuestionAndAnswer } from '../../../api/lib/qa-list';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

/** Checks and sorts the API response; also applied to the data baked at build time. */
export function toSortedQuestions(value: unknown): QuestionAndAnswer[] {
  return parseQuestionsAndAnswers(value).sort(
    (a, b) =>
      a.category.localeCompare(b.category, 'de') || a.question.localeCompare(b.question, 'de')
  );
}

const questions = createResource<QuestionAndAnswer[], void, unknown>('/qa', {
  transform: toSortedQuestions,
});

export const QA_STORE = loadStateOf(questions.state);

/** Fetches and stores the sorted Q&A collection, joining a running request. */
export function fetchQuestionsAndAnswers(): Promise<void> {
  return questions.load({ maxAge: 0 });
}
