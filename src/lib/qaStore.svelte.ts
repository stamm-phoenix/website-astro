import { fetchApi } from './api';
import { parseQuestionsAndAnswers } from './types';
import type { QuestionAndAnswer } from './types';

interface QAStoreState {
  data: QuestionAndAnswer[] | null;
  loading: boolean;
  error: boolean;
}

export const qaStore = $state<QAStoreState>({
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

  qaStore.loading = true;
  qaStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = parseQuestionsAndAnswers(await fetchApi<unknown>('/qa'));
      qaStore.data = data.sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'de') || a.question.localeCompare(b.question, 'de')
      );
    } catch {
      qaStore.error = true;
    } finally {
      fetchPromise = null;
      qaStore.loading = false;
    }
  })();

  return fetchPromise;
}
