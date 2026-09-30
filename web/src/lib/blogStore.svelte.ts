import { fetchApi } from './api';
import type { BlogPostSummary } from './types';

interface BlogStoreState {
  data: BlogPostSummary[] | null;
  loading: boolean;
  error: boolean;
}

export const blogStore = $state<BlogStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/** Loads the published posts (newest first, as sorted by the API). */
export function fetchBlogPosts(): Promise<void> {
  if (blogStore.data !== null) return Promise.resolve();
  if (fetchPromise) return fetchPromise;

  blogStore.loading = true;
  blogStore.error = false;

  fetchPromise = (async () => {
    try {
      blogStore.data = await fetchApi<BlogPostSummary[]>('/blog');
    } catch {
      blogStore.error = true;
    } finally {
      fetchPromise = null;
      blogStore.loading = false;
    }
  })();

  return fetchPromise;
}
