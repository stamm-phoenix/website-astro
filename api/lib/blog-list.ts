import { loadEntry } from './blog-read';
export { getBlogEntry, getBlogEntries, getBlogList } from './blog-read';
export type { BlogEntry, BlogListEntry } from './blog-read';
import { sql } from 'kysely';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  parseId,
  requireVersion,
  toVersion,
} from './db';
import type { Db } from './db';
import type { BlogImage, BlogPostInput } from './validation/blog';
import { MAX_BLOG_IMAGES } from './validation/blog';

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
