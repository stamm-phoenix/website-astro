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

/**
 * Fetches and stores the sorted Q&A collection, reusing any active request.
 */
export function fetchQuestionsAndAnswers(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  QA_STORE.loading = true;
  QA_STORE.error = false;

  fetchPromise = (async () => {
    try {
      const data = parseQuestionsAndAnswers(await fetchApi<unknown>('/qa'));
      QA_STORE.data = data.sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'de') || a.question.localeCompare(b.question, 'de')
      );
    } catch {
      QA_STORE.error = true;
    } finally {
      fetchPromise = null;
      QA_STORE.loading = false;
    }
  })();

  return fetchPromise;
}
