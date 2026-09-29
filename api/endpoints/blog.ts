import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { BlogEntry } from '../lib/blog-list';
import {
  BLOG_IMAGE_WIDTHS,
  findImage,
  getBlogEntries,
  getBlogEntry,
  getBlogListId,
  getExcerpt,
  getPublicImageUrl,
  getReadingMinutes,
  renderBlogContent,
} from '../lib/blog-list';
import type { BlogImage } from '../lib/pflege-validation';
import { fetchSharePointImage } from '../lib/sharepoint-images';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const LIST_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60' };
/**
 * Only browsers cache images, and only for an hour: a deleted image or unpublished post
 * (e.g. after a withdrawn photo consent) must disappear soon, also from shared caches.
 */
const IMAGE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=3600' };
const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Der Beitrag wurde nicht gefunden.');

interface BlogCover {
  url: string;
  alt: string;
  width: number;
  height: number;
}

interface BlogSummary {
  id: string;
  title: string;
  date: string;
  excerpt: string;
  readingMinutes: number;
  cover?: BlogCover;
}

interface BlogPost extends BlogSummary {
  content: string;
}

function toCover(entry: BlogEntry): BlogCover | undefined {
  const image: BlogImage | undefined = entry.images[0];
  if (!image) return undefined;
  const width = Math.min(BLOG_IMAGE_WIDTHS[BLOG_IMAGE_WIDTHS.length - 1], image.width);
  return {
    url: getPublicImageUrl(entry.id, image.file, width),
    alt: image.alt,
    width: image.width,
    height: image.height,
  };
}

function toSummary(entry: BlogEntry): BlogSummary {
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    // Cards without a cover show more of the text instead
    excerpt: getExcerpt(entry.content, entry.images.length > 0 ? 200 : 600),
    readingMinutes: getReadingMinutes(entry.content),
    cover: toCover(entry),
  };
}

/** A published post, or undefined for drafts and unknown IDs. */
async function getPublishedEntry(id: string | undefined): Promise<BlogEntry | undefined> {
  const entry = await getBlogEntry(id ?? '');
  return entry?.published ? entry : undefined;
}

/** GET: published posts, newest first. */
export async function GetBlogEndpoint(): Promise<HttpResponseInit> {
  const entries = await getBlogEntries();
  return {
    status: 200,
    headers: LIST_CACHE_HEADERS,
    jsonBody: entries.filter((entry) => entry.published).map(toSummary),
  };
}

/** GET: a published post with its rendered content. */
export async function GetBlogPostEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const entry = await getPublishedEntry(request.params.id);
  if (!entry) return NOT_FOUND;

  const post: BlogPost = { ...toSummary(entry), content: renderBlogContent(entry) };
  return { status: 200, headers: LIST_CACHE_HEADERS, jsonBody: post };
}

/** GET: an image of a published post in one of the offered widths. */
export async function GetBlogImageEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const entry = await getPublishedEntry(request.params.id);
  const found = entry && findImage(entry, request.params.file, request.query.get('w'));
  if (!entry || !found) return NOT_FOUND;

  const response = await fetchSharePointImage(
    getBlogListId(),
    entry.id,
    found.image.file,
    found.dimension,
    context
  );
  if (response.status !== 200) return response;
  return {
    ...response,
    headers: { ...(response.headers as Record<string, string>), ...IMAGE_CACHE_HEADERS },
  };
}

export const GetBlog = withErrorHandling(GetBlogEndpoint);
export const GetBlogPost = withErrorHandling(GetBlogPostEndpoint);
export const GetBlogImage = withErrorHandling(GetBlogImageEndpoint);
