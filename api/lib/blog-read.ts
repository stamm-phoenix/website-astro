import { readBlogWorkflow } from './blog-workflow-read';
import type { BlogWorkflow } from './blog-workflow-model';
import type { Selectable } from 'kysely';
import type { BlogImageTable, BlogPostTable } from './db-schema-blog';
import { getDb, parseId, toDateString, toVersion } from './db';
import type { Db } from './db';
import type { BlogImage } from './validation/blog';
import { sanitizeBlogHtml } from './validation/rich-text';

// Hold shared post locks until images are read, including under RCSI. Image
// writers update the parent first; they cannot commit draft images between
// these reads. Release the transaction before any Blob Storage I/O.
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
  return getDb()
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (db) => {
      const posts = await db
        .selectFrom('content.blog_post')
        .selectAll()
        .orderBy('post_date', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const images = await loadImagesByPost(db);
      return posts.map((post) => toBlogEntry(post, images.get(post.id) ?? []));
    });
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

export async function loadEntry(db: Db, id: number): Promise<BlogEntry | undefined> {
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
  return numericId === undefined
    ? undefined
    : getDb()
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute((trx) => loadEntry(trx, numericId));
}
