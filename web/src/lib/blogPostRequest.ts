import { fetchApi } from './api';
import type { StaffBlogPost } from './types';

/**
 * The post the editor page opens, requested by a small script of the page before the editor's
 * code has loaded: the editor (Tiptap) is large, and its request would only start after it.
 */
let early: { id: string; post: Promise<StaffBlogPost>; at: number } | null = null;
/** Whether the editor asked for a post already; a later early request would be an old one. */
let editorAsked = false;
/** An early answer older than this is not taken, e.g. after the editor was left at once. */
const EARLY_MAX_AGE_MS = 30_000;

function postUrl(id: string): string {
  return `/intern/pflege/blog/${encodeURIComponent(id)}`;
}

/** Starts loading the post named in the address of the editor page, if there is one. */
export function requestBlogPostEarly(): void {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id || editorAsked) return;
  const post = fetchApi<StaffBlogPost>(postUrl(id));
  // The editor reports a failure when it takes the answer
  post.catch(() => undefined);
  early = { id, post, at: Date.now() };
}

/**
 * Loads a post for the editor. The first call takes the answer of `requestBlogPostEarly` for the
 * same post; every later call (e.g. „Neu laden“ after a conflict) asks the server again.
 */
export function requestBlogPost(id: string): Promise<StaffBlogPost> {
  const taken = early?.id === id && Date.now() - early.at < EARLY_MAX_AGE_MS ? early.post : null;
  early = null;
  editorAsked = true;
  return taken ?? fetchApi<StaffBlogPost>(postUrl(id));
}
