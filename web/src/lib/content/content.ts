import { DOMParser } from 'linkedom';
import type { BakedImages } from '../bakedImages';
import { setServerHtmlParser } from '../html';
import { sortAktionen } from '../aktionenStore.svelte';
import { sortDownloads } from '../downloadsStore.svelte';
import { sortGruppenstunden } from '../gruppenstundenStore.svelte';
import { toSortedQuestions } from '../qaStore.svelte';
import type {
  Aktion,
  BlogPost,
  BlogPostSummary,
  DownloadFile,
  Gruppenstunde,
  InstagramPost,
  QuestionAndAnswer,
  Vorstand,
} from '../types';
import { fetchFromSource, getContentSource, isStrict } from './source';
import { stageImage, stageSource } from './staging';
import { CONTENT_SOURCES, type ContentSourceName, hashBody } from './version';

/**
 * Loads the public content for the pages while they are prerendered, and bakes the images it
 * refers to. Only import this from the frontmatter of `.astro` pages: it runs at build time.
 * The islands get the result as props and refresh it from the API in the browser.
 */

// The sanitizers in lib/api.ts and lib/blog.ts need a DOM parser while rendering the islands
setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);

/** Data for an island: `null` if it could not be baked; then the browser loads it as before. */
export interface Baked<T> {
  data: T | null;
  images: BakedImages;
}

const cache = new Map<string, Promise<unknown>>();

/** Each source is requested once per build; the dev server always asks again. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (import.meta.env.DEV) return load();
  let promise = cache.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = load();
    cache.set(key, promise);
  }
  return promise;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson<T>(path: string): Promise<{ data: T; body: Uint8Array } | null> {
  const response = await fetchFromSource(path);
  if (response.status === 404) return null;
  if (response.status !== 200) {
    // The start of the body tells an API error apart from one of the platform
    const body = new TextDecoder().decode(response.body.slice(0, 300)).replace(/\s+/g, ' ').trim();
    throw new Error(
      `${path} answered with ${response.status}${body ? ` (${response.contentType}): ${body}` : ''}`
    );
  }
  return { data: JSON.parse(new TextDecoder().decode(response.body)) as T, body: response.body };
}

function loadSource<T>(name: ContentSourceName): Promise<T | null> {
  return once(`source:${name}`, async () => {
    if (getContentSource() === 'none') {
      stageSource(name, { ok: false });
      return null;
    }
    try {
      const result = await requestJson<T>(CONTENT_SOURCES[name]);
      if (!result) throw new Error(`${CONTENT_SOURCES[name]} answered with 404`);
      stageSource(name, { ok: true, hash: hashBody(result.body) });
      return result.data;
    } catch (error: unknown) {
      if (isStrict(name))
        throw new Error(`Baking ${name} failed: ${describe(error)}`, { cause: error });
      console.warn(`[baked-content] ${name} is not baked: ${describe(error)}`);
      stageSource(name, { ok: false });
      return null;
    }
  });
}

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/**
 * Copies an image into the build; the file name is a hash of the content, so it can be cached
 * forever. Images that fail stay on their API URL: a missing copy is no reason to fail a build.
 */
function bakeImage(apiUrl: string): Promise<string | null> {
  return once(`image:${apiUrl}`, async () => {
    try {
      const response = await fetchFromSource(apiUrl);
      const extension = EXTENSIONS[response.contentType.split(';')[0].trim().toLowerCase()];
      if (response.status !== 200 || !extension) {
        throw new Error(`answered with ${response.status} ${response.contentType}`);
      }
      const fileName = `${hashBody(response.body).slice(0, 20)}.${extension}`;
      stageImage(fileName, response.body);
      return `/baked/${fileName}`;
    } catch (error: unknown) {
      console.warn(`[baked-content] Image ${apiUrl} is not baked: ${describe(error)}`);
      return null;
    }
  });
}

async function bakeImages(apiUrls: string[]): Promise<BakedImages> {
  const urls = [...new Set(apiUrls)];
  const baked = await Promise.all(urls.map((url) => bakeImage(url)));
  const images: BakedImages = {};
  urls.forEach((url, i) => {
    const local = baked[i];
    if (local) images[url] = local;
  });
  return images;
}

const leaderImage = (id: string): string => `/api/leitende/${id}/image`;

/** Image URLs in the content of a blog post (`src` and `srcset`). */
function blogContentImages(html: string): string[] {
  return Array.from(html.matchAll(/\/api\/blog\/[^\s"',]+/g), (match) => match[0]);
}

function blogCoverImages(posts: BlogPostSummary[]): string[] {
  return posts.flatMap((post) => (post.cover ? [post.cover.url] : []));
}

function instagramImages(posts: InstagramPost[]): string[] {
  return posts.flatMap((post) =>
    Array.from({ length: post.imageCount }, (_, index) => [
      `/api/instagram/${post.id}/image?index=${index}`,
      `/api/instagram/${post.id}/image?index=${index}&size=large`,
    ]).flat()
  );
}

export async function getGruppenstundenContent(): Promise<Baked<Gruppenstunde[]>> {
  const data = await loadSource<Gruppenstunde[]>('gruppenstunden');
  const leaders = (data ?? []).flatMap((g) => g.leitende ?? []).filter((l) => l.hasImage);
  return {
    data: data && sortGruppenstunden([...data]),
    images: await bakeImages(leaders.map((l) => leaderImage(l.id))),
  };
}

export async function getVorstandContent(): Promise<Baked<Vorstand[]>> {
  const data = await loadSource<Vorstand[]>('vorstand');
  const withImage = (data ?? []).filter((person) => person.hasImage);
  return { data, images: await bakeImages(withImage.map((person) => leaderImage(person.id))) };
}

export async function getAktionenContent(): Promise<Baked<Aktion[]>> {
  const data = await loadSource<Aktion[]>('aktionen');
  return { data: data && sortAktionen([...data]), images: {} };
}

export async function getDownloadsContent(): Promise<Baked<DownloadFile[]>> {
  const data = await loadSource<DownloadFile[]>('downloads');
  const urls = (data ?? []).flatMap((file) => [
    `/api/downloads/${file.id}/image/small`,
    `/api/downloads/${file.id}/image/large`,
  ]);
  return { data: data && sortDownloads([...data]), images: await bakeImages(urls) };
}

export async function getQuestionsContent(): Promise<Baked<QuestionAndAnswer[]>> {
  const data = await loadSource<unknown>('qa');
  if (data === null) return { data: null, images: {} };
  try {
    return { data: toSortedQuestions(data), images: {} };
  } catch (error: unknown) {
    if (isStrict('qa')) throw error;
    console.warn(`[baked-content] qa is not baked: ${describe(error)}`);
    return { data: null, images: {} };
  }
}

export interface NewsContent {
  blog: BlogPostSummary[] | null;
  instagram: InstagramPost[] | null;
  images: BakedImages;
}

/** Blog posts and Instagram posts, for „Neues aus dem Stamm“ and the blog overview. */
export async function getNewsContent(): Promise<NewsContent> {
  const [blog, instagram] = await Promise.all([
    loadSource<BlogPostSummary[]>('blog'),
    loadSource<InstagramPost[]>('instagram'),
  ]);
  const images = await bakeImages([
    ...blogCoverImages(blog ?? []),
    ...instagramImages(instagram ?? []),
  ]);
  return { blog, instagram, images };
}

/** Published posts, for the static post pages. */
export async function getBlogPosts(): Promise<BlogPostSummary[]> {
  return (await loadSource<BlogPostSummary[]>('blog')) ?? [];
}

/** A published post with its images; `null` if it is gone or could not be loaded. */
export async function getBlogPostContent(id: string): Promise<Baked<BlogPost>> {
  try {
    const result = await once(`blog:${id}`, () =>
      requestJson<BlogPost>(`/api/blog/${encodeURIComponent(id)}`)
    );
    if (!result) {
      // Listed, but gone by now: a content build must not publish the page without its post
      if (isStrict('blog')) throw new Error(`/api/blog/${id} answered with 404`);
      return { data: null, images: {} };
    }
    const post = result.data;
    const images = await bakeImages([
      ...blogCoverImages([post]),
      ...blogContentImages(post.content),
    ]);
    return { data: post, images };
  } catch (error: unknown) {
    if (isStrict('blog')) {
      throw new Error(`Baking blog post ${id} failed: ${describe(error)}`, { cause: error });
    }
    console.warn(`[baked-content] Blog post ${id} is not baked: ${describe(error)}`);
    return { data: null, images: {} };
  }
}
