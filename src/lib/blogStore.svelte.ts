import type { BlogPost } from "./types";
import { fetchApi } from "./api";

interface BlogStoreState {
  data: BlogPost[] | null;
  loading: boolean;
  error: boolean;
}

export const blogStore = $state<BlogStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchBlog(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (blogStore.data !== null) return Promise.resolve();

  blogStore.loading = true;
  blogStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = await fetchApi<BlogPost[]>("/blog");
      blogStore.data = data.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      blogStore.loading = false;
    } catch {
      fetchPromise = null;
      blogStore.error = true;
      blogStore.loading = false;
    }
  })();

  return fetchPromise;
}
