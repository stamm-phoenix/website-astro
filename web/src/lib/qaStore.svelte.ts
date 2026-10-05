import { fetchApi } from './api';
import { parseQuestionsAndAnswers } from './types';
import type { QuestionAndAnswer } from './types';

interface QAStoreState {
  data: QuestionAndAnswer[] | null;
  loading: boolean;
  error: boolean;
}

export const QA_STORE = $state<QAStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/** Checks and sorts the API response; also applied to the data baked at build time. */
export function toSortedQuestions(value: unknown): QuestionAndAnswer[] {
  return parseQuestionsAndAnswers(value).sort(
    (a, b) =>
      a.category.localeCompare(b.category, 'de') || a.question.localeCompare(b.question, 'de')
  );
}

/**
 * Fetches and stores the sorted Q&A collection, reusing any active request.
 */
export function fetchQuestionsAndAnswers(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  QA_STORE.loading = true;
  QA_STORE.error = false;

  fetchPromise = (async () => {
    try {
      QA_STORE.data = toSortedQuestions(await fetchApi<unknown>('/qa'));
    } catch {
      QA_STORE.error = true;
    } finally {
      fetchPromise = null;
      QA_STORE.loading = false;
    }
  })();

  return fetchPromise;
}
