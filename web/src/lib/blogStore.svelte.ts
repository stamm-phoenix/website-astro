import type { BlogPostSummary } from './types';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

const blog = createResource<BlogPostSummary[]>('/blog');

export const blogStore = loadStateOf(blog.state);

/** Loads the published posts (newest first, as sorted by the API). */
export function fetchBlogPosts(): Promise<void> {
  return blog.load();
}
