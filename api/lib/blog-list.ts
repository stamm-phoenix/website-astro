import { readBlogWorkflow } from './blog-workflow-read';
import type { BlogWorkflow } from './blog-workflow-model';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { BlogImageTable, BlogPostTable } from './db-schema-blog';
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
import type { BlogImage, BlogPostInput } from './validation/blog';
import { MAX_BLOG_IMAGES } from './validation/blog';
import { sanitizeBlogHtml } from './validation/rich-text';

/**
 * Blog posts in Azure SQL (`content.blog_post`, `content.blog_image`, migration
 * `0003_blog_faq.sql`). The image files are in Blob Storage (`blog-images.ts`).
 */
export interface BlogEntry {
  workflow: BlogWorkflow;
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
import { getPlainText } from './blog-presentation';

type ImageRow = Selectable<BlogImageTable>;

/** The images of a post in display order. */
function toImages(imageRows: ImageRow[]): BlogImage[] {
  return imageRows
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      file: image.file,
      alt: image.alt,
      width: image.width,
      height: image.height,
    }));
}

/** Sanitized on write; again on read, so an image that is gone never leaves a placeholder. */
function readContent(content: string, images: BlogImage[]): string {
  return sanitizeBlogHtml(
    content,
    images.map((image) => image.file)
  ).html;
}

function toBlogEntry(row: Selectable<BlogPostTable>, imageRows: ImageRow[]): BlogEntry {
  const images = toImages(imageRows);
  return {
    workflow: readBlogWorkflow(row.workflow_json, row.published),
    id: String(row.id),
    etag: toVersion(row.version),
    title: row.title,
    date: toDateString(row.post_date),
    published: row.published,
    content: readContent(row.content, images),
    images,
  };
}

/** The image rows of all posts, by post. */
async function loadImagesByPost(db: Db): Promise<Map<number, ImageRow[]>> {
  const rows = await db
    .selectFrom('content.blog_image')
    .select(['post_id', 'file', 'position', 'alt', 'width', 'height'])
    .execute();
  const byPost = new Map<number, ImageRow[]>();
  for (const row of rows) {
    const images = byPost.get(row.post_id);
    if (images) images.push(row);
    else byPost.set(row.post_id, [row]);
  }
  return byPost;
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
    loadImagesByPost(db),
  ]);
  return posts.map((post) => toBlogEntry(post, images.get(post.id) ?? []));
}

/** A post in the list of the Leitendenbereich. */
export interface BlogListEntry {
  workflow: BlogWorkflow;
  id: string;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  published: boolean;
  cover: BlogImage | null;
  imageCount: number;
  /** Length of the visible text, see `getPlainText`. */
  textLength: number;
}

/**
 * All posts including drafts, newest first, with only what the list shows: without version and
 * change log, and the text only to count it.
 */
export async function getBlogList(): Promise<BlogListEntry[]> {
  const db = getDb();
  const [posts, imagesByPost] = await Promise.all([
    db
      .selectFrom('content.blog_post')
      .select(['id', 'title', 'post_date', 'published', 'content', 'workflow_json'])
      .orderBy('post_date', 'desc')
      .orderBy('id', 'desc')
      .execute(),
    loadImagesByPost(db),
  ]);
  return posts.map((post) => {
    const images = toImages(imagesByPost.get(post.id) ?? []);
    return {
      workflow: readBlogWorkflow(post.workflow_json, post.published),
      id: String(post.id),
      title: post.title,
      date: toDateString(post.post_date),
      published: post.published,
      cover: images[0] ?? null,
      imageCount: images.length,
      textLength: getPlainText(readContent(post.content, images)).length,
    };
  });
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
    published: false,
    workflow_json: JSON.stringify({ state: 'draft' }),
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
    workflow_json?: string;
    content?: string;
    updated_by: string;
  }
): Promise<string> {
  let query = db
    .updateTable('content.blog_post')
    .set({
      published: false,
      workflow_json: JSON.stringify({ state: 'draft' }),
      ...values,
      updated_at: sql<Date>`SYSUTCDATETIME()`,
    })
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

export {
  BLOG_IMAGE_WIDTHS,
  getImageWidths,
  findImage,
  getPublicImageUrl,
  renderBlogContent,
  getPlainText,
  getExcerpt,
  getReadingMinutes,
} from './blog-presentation';
