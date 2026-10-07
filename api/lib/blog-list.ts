import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { BlogImageTable, BlogPostTable } from './db-schema';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  parseId,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { Db } from './db';
import type { BlogImage, BlogPostInput } from './pflege-validation';
import { MAX_BLOG_IMAGES, escapeAttribute, sanitizeBlogHtml } from './pflege-validation';

/**
 * Blog posts in Azure SQL (`content.blog_post`, `content.blog_image`, migration
 * `0003_blog_faq.sql`). The image files are in Blob Storage (`blog-images.ts`).
 */
export interface BlogEntry {
  id: string;
  etag: string;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  published: boolean;
  /** Canonical HTML with `<img data-bild>` placeholders. */
  content: string;
  /** In display order; the first one is the cover image. */
  images: BlogImage[];
}

/** Widths offered for images in posts; the upload scales to at most the largest one. */
export const BLOG_IMAGE_WIDTHS = [800, 1600];

function toBlogEntry(
  row: Selectable<BlogPostTable>,
  imageRows: Selectable<BlogImageTable>[]
): BlogEntry {
  const images = imageRows
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      file: image.file,
      alt: image.alt,
      width: image.width,
      height: image.height,
    }));
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    title: row.title,
    date: toDateString(row.post_date),
    published: row.published,
    // Sanitized on write; again on read, so an image that is gone never leaves a placeholder
    content: sanitizeBlogHtml(
      row.content,
      images.map((image) => image.file)
    ).html,
    images,
  };
}

/** All posts including drafts, newest first. */
export async function getBlogEntries(): Promise<BlogEntry[]> {
  const db = getDb();
  const [posts, images] = await Promise.all([
    db
      .selectFrom('content.blog_post')
      .selectAll()
      .orderBy('post_date', 'desc')
      .orderBy('id', 'desc')
      .execute(),
    db.selectFrom('content.blog_image').selectAll().execute(),
  ]);
  return posts.map((post) =>
    toBlogEntry(
      post,
      images.filter((image) => image.post_id === post.id)
    )
  );
}

async function loadEntry(db: Db, id: number): Promise<BlogEntry | undefined> {
  const post = await db
    .selectFrom('content.blog_post')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!post) return undefined;
  const images = await db
    .selectFrom('content.blog_image')
    .selectAll()
    .where('post_id', '=', id)
    .execute();
  return toBlogEntry(post, images);
}

/** A single post including drafts, or undefined if it does not exist. */
export async function getBlogEntry(id: string): Promise<BlogEntry | undefined> {
  const numericId = parseId(id);
  return numericId === undefined ? undefined : loadEntry(getDb(), numericId);
}

function toColumns(input: BlogPostInput, actor: string) {
  return {
    title: input.title,
    post_date: input.date,
    published: input.published,
    content: input.content,
    updated_by: actor,
  };
}

/** Creates a post without images; returns its ID and version. */
export async function createBlogPost(
  input: BlogPostInput,
  actor: string
): Promise<{ id: string; etag: string }> {
  const row = await getDb()
    .insertInto('content.blog_post')
    .values(toColumns(input, actor))
    .output(['inserted.id', 'inserted.version'])
    .executeTakeFirstOrThrow();
  return { id: String(row.id), etag: toVersion(row.version) };
}

/**
 * Changes the post row, with a version only if it still matches, and returns the new version.
 * Every change of the images goes through here too, so the version of the post covers them.
 */
async function updatePost(
  db: Db,
  id: number,
  etag: string | undefined,
  values: {
    title?: string;
    post_date?: string;
    published?: boolean;
    content?: string;
    updated_by: string;
  }
): Promise<string> {
  let query = db
    .updateTable('content.blog_post')
    .set({ ...values, updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', id);
  if (etag !== undefined) query = query.where('version', '=', requireVersion(etag));
  const row = await query.output('inserted.version').executeTakeFirst();
  if (row) return toVersion(row.version);
  const exists = await db
    .selectFrom('content.blog_post')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

function requireId(id: string): number {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  return numericId;
}

/** Saves title, date, status and text; returns the new version. */
export async function updateBlogPost(
  id: string,
  input: BlogPostInput,
  etag: string | undefined,
  actor: string
): Promise<string> {
  return updatePost(getDb(), requireId(id), etag, toColumns(input, actor));
}

/** Deletes a post with its image rows; the files are removed by the caller. */
export async function deleteBlogPost(id: string, etag: string | undefined): Promise<void> {
  const numericId = requireId(id);
  const db = getDb();
  let query = db.deleteFrom('content.blog_post').where('id', '=', numericId);
  if (etag !== undefined) query = query.where('version', '=', requireVersion(etag));
  const result = await query.executeTakeFirst();
  if (Number(result.numDeletedRows) > 0) return;
  const exists = await db
    .selectFrom('content.blog_post')
    .select('id')
    .where('id', '=', numericId)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** The post was given too many images; checked in the transaction that adds one. */
export class TooManyImagesError extends Error {
  constructor() {
    super(`Ein Beitrag kann höchstens ${MAX_BLOG_IMAGES} Bilder haben.`);
    this.name = 'TooManyImagesError';
  }
}

async function replaceImages(db: Db, id: number, images: BlogImage[]): Promise<void> {
  await db.deleteFrom('content.blog_image').where('post_id', '=', id).execute();
  if (images.length === 0) return;
  await db
    .insertInto('content.blog_image')
    .values(
      images.map((image, position) => ({
        post_id: id,
        file: image.file,
        position,
        alt: image.alt,
        width: image.width,
        height: image.height,
      }))
    )
    .execute();
}

/**
 * Changes the images of a post in one transaction: `change` gets the current images and
 * returns the new list. Returns the new version and images.
 */
async function changeImages(
  id: string,
  etag: string | undefined,
  actor: string,
  change: (images: BlogImage[]) => BlogImage[]
): Promise<{ etag: string; images: BlogImage[] }> {
  const numericId = requireId(id);
  return inTransaction(async (trx) => {
    // The update first: it locks the post row until the end of the transaction
    const version = await updatePost(trx, numericId, etag, { updated_by: actor });
    const entry = await loadEntry(trx, numericId);
    if (!entry) throw new RecordNotFoundError();
    const images = change(entry.images);
    if (images.length > MAX_BLOG_IMAGES) throw new TooManyImagesError();
    await replaceImages(trx, numericId, images);
    return { etag: version, images };
  });
}

/** Adds an image (its files are already stored) at the end. */
export function addBlogImage(
  id: string,
  image: BlogImage,
  etag: string | undefined,
  actor: string
): Promise<{ etag: string; images: BlogImage[] }> {
  return changeImages(id, etag, actor, (images) => [...images, image]);
}

/** Saves alt texts and order, as validated against the images loaded before. */
export function saveBlogImages(
  id: string,
  images: BlogImage[],
  etag: string | undefined,
  actor: string
): Promise<{ etag: string; images: BlogImage[] }> {
  return changeImages(id, etag, actor, (current) => {
    // A concurrent change without version (upload, delete) must not be undone
    const same =
      current.length === images.length &&
      images.every((image) => current.some((c) => c.file === image.file));
    if (!same) throw new VersionConflictError();
    return images;
  });
}

/** Removes an image from the post; its files are deleted by the caller. */
export function removeBlogImage(
  id: string,
  file: string,
  etag: string | undefined,
  actor: string
): Promise<{ etag: string; images: BlogImage[] }> {
  return changeImages(id, etag, actor, (images) => {
    if (!images.some((image) => image.file === file)) throw new RecordNotFoundError();
    return images.filter((image) => image.file !== file);
  });
}

/** Public URL of an image of a published post. */
export function getPublicImageUrl(postId: string, file: string, width: number): string {
  return `/api/blog/${postId}/bilder/${file}?w=${width}`;
}

/** Replaces the `<img data-bild>` placeholders with complete, responsive image tags. */
export function renderBlogContent(entry: BlogEntry): string {
  const byFile = new Map(entry.images.map((image) => [image.file, image]));
  return entry.content.replace(/<img data-bild="([^"]+)">/g, (_match, file: string) => {
    const image = byFile.get(file);
    if (!image) return '';
    const widths = getImageWidths(image.width);
    const srcset = widths
      .map((width) => `${getPublicImageUrl(entry.id, file, width)} ${width}w`)
      .join(', ');
    const src = getPublicImageUrl(entry.id, file, widths[widths.length - 1]);
    return (
      `<img src="${src}" srcset="${srcset}" sizes="(min-width: 768px) 720px, 100vw"` +
      ` alt="${escapeAttribute(image.alt)}" width="${image.width}" height="${image.height}"` +
      ` loading="lazy" decoding="async">`
    );
  });
}

/** The character of a numeric entity; invalid code points become U+FFFD instead of throwing. */
function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : '\uFFFD';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Visible text of a post, with blocks separated by spaces. */
export function getPlainText(content: string): string {
  // Collects the text between tags in one pass: blocks become spaces, inline tags (links,
  // bold) disappear without a gap. Any `<` or `>` left over from malformed tags is dropped;
  // text characters are stored as entities anyway.
  let text = '';
  let last = 0;
  for (const match of content.matchAll(/<[^<>]*>?/g)) {
    text += content.slice(last, match.index).replace(/[<>]/g, '');
    if (/^<\/?(?:p|div|h2|h3|ul|ol|li|br|img)\b/i.test(match[0])) text += ' ';
    last = match.index + match[0].length;
  }
  text += content.slice(last).replace(/[<>]/g, '');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** The beginning of the text, cut at a word boundary. */
export function getExcerpt(content: string, maxLength = 200): string {
  const text = getPlainText(content);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, '')} …`;
}

/** Reading time in minutes at about 200 words per minute. */
export function getReadingMinutes(content: string): number {
  const words = getPlainText(content).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * Finds an image of a post and the width `w`; only the widths used in `srcset` are served, so
 * no other sizes can be requested.
 */
export function findImage(
  entry: BlogEntry,
  file: string | undefined,
  requestedWidth: string | null
): { image: BlogImage; width: number } | undefined {
  const image = entry.images.find((i) => i.file === file);
  if (!image) return undefined;
  const width = Number(requestedWidth ?? BLOG_IMAGE_WIDTHS[0]);
  if (!getImageWidths(image.width).includes(width)) return undefined;
  return { image, width };
}

/** The widths an image is stored and offered in; smaller images once, at their own width. */
export function getImageWidths(imageWidth: number): number[] {
  return [...new Set(BLOG_IMAGE_WIDTHS.map((width) => Math.min(width, imageWidth)))];
}
