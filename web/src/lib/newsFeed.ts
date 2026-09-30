import type { BlogPostSummary, InstagramPost } from './types';

/** Blog posts and Instagram posts in one list, e.g. for „Neues aus dem Stamm“. */
export interface BlogNewsItem {
  type: 'blog';
  key: string;
  /** Milliseconds since the epoch, for sorting */
  time: number;
  post: BlogPostSummary;
}

export interface InstagramNewsItem {
  type: 'instagram';
  key: string;
  time: number;
  post: InstagramPost;
}

export type NewsItem = BlogNewsItem | InstagramNewsItem;

/** Mixes both kinds of posts, newest first. */
export function mergeNews(
  blogPosts: BlogPostSummary[],
  instagramPosts: InstagramPost[]
): NewsItem[] {
  const items: NewsItem[] = [
    ...blogPosts.map((post): BlogNewsItem => ({
      type: 'blog',
      key: `blog-${post.id}`,
      // Blog posts only have a date; noon keeps them on that day in every time zone
      time: Date.parse(`${post.date}T12:00:00`),
      post,
    })),
    ...instagramPosts.map((post): InstagramNewsItem => ({
      type: 'instagram',
      key: `instagram-${post.id}`,
      time: Date.parse(post.timestamp),
      post,
    })),
  ];
  return items.sort((a, b) => (b.time || 0) - (a.time || 0));
}
