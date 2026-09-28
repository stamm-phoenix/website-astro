import { getSharePointListItem, getSharePointListItems } from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';
import type { BlogImage } from './pflege-validation';
import {
  BLOG_IMAGE_FILE,
  MAX_BLOG_IMAGES,
  escapeAttribute,
  sanitizeBlogHtml,
} from './pflege-validation';

/**
 * Blog posts from the SharePoint list „Blog“. Columns: `Title`, `InhaltHtml` (plain text with
 * canonical HTML, see `sanitizeBlogHtml`), `Bilder` (plain text with a JSON array of
 * `BlogImage`, the attachments of the item), `Veroeffentlicht` (yes/no) and `Datum` (text,
 * `YYYY-MM-DD`; a text column like in the Nikolaus lists, so no time zone can shift the day).
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
  images: BlogImage[];
}

interface BlogListItem {
  id: string;
  eTag?: string;
  fields: {
    Title?: string;
    InhaltHtml?: string;
    Bilder?: string;
    Veroeffentlicht?: boolean;
    Datum?: string;
  };
}

/** Widths offered for images in posts; the upload scales to at most the largest one. */
export const BLOG_IMAGE_WIDTHS = [800, 1600];

export function getBlogListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_BLOG_LIST_ID);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10000;
}

/** Reads the `Bilder` column; invalid entries are skipped. */
export function parseImages(raw: string | undefined): BlogImage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const images: BlogImage[] = [];
  for (const value of parsed) {
    const entry = value as Partial<BlogImage> | null;
    if (
      typeof entry?.file === 'string' &&
      BLOG_IMAGE_FILE.test(entry.file) &&
      !images.some((image) => image.file === entry.file) &&
      isPositiveInteger(entry.width) &&
      isPositiveInteger(entry.height)
    ) {
      images.push({
        file: entry.file,
        alt: typeof entry.alt === 'string' ? entry.alt : '',
        width: entry.width,
        height: entry.height,
      });
    }
  }
  return images.slice(0, MAX_BLOG_IMAGES);
}

export function serializeImages(images: BlogImage[]): string {
  return JSON.stringify(images);
}

function toBlogEntry(item: BlogListItem): BlogEntry {
  const images = parseImages(item.fields.Bilder);
  return {
    id: item.id,
    etag: item.eTag ?? '',
    title: item.fields.Title ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(item.fields.Datum ?? '') ? (item.fields.Datum ?? '') : '',
    published: item.fields.Veroeffentlicht === true,
    // Sanitized again on read, in case the column was edited in SharePoint directly
    content: sanitizeBlogHtml(
      item.fields.InhaltHtml ?? '',
      images.map((image) => image.file)
    ).html,
    images,
  };
}

/** All posts including drafts, newest first. */
export async function getBlogEntries(): Promise<BlogEntry[]> {
  const items = (await getSharePointListItems(getBlogListId(), {
    expand: 'fields',
  })) as BlogListItem[];

  return items
    .map(toBlogEntry)
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
}

/** A single post including drafts, or undefined if it does not exist. */
export async function getBlogEntry(id: string): Promise<BlogEntry | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const item = (await getSharePointListItem(getBlogListId(), id)) as BlogListItem | undefined;
  return item ? toBlogEntry(item) : undefined;
}

/**
 * SharePoint thumbnail box for an image scaled to `width`, keeping the aspect ratio, so the
 * delivered image really has the width announced in `srcset`.
 */
export function getThumbnailDimension(image: BlogImage, width: number): string {
  const scaled = Math.min(width, image.width);
  return `${scaled}x${Math.max(1, Math.round((scaled * image.height) / image.width))}`;
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
    // Smaller images than a width are offered once, at their own width
    const widths = [...new Set(BLOG_IMAGE_WIDTHS.map((width) => Math.min(width, image.width)))];
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

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&amp;/g, '&');
}

/** Visible text of a post, with blocks separated by spaces. */
export function getPlainText(content: string): string {
  // Blocks become spaces, inline tags (links, bold) disappear without a gap
  const text = content
    .replace(/<\/?(?:p|div|h2|h3|ul|ol|li|br|img)\b[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '');
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
 * Finds an image of a post and the thumbnail box for the width `w`; only the widths used in
 * `srcset` are served, so no other thumbnail sizes can be requested.
 */
export function findImage(
  entry: BlogEntry,
  file: string | undefined,
  requestedWidth: string | null
): { image: BlogImage; dimension: string } | undefined {
  const image = entry.images.find((i) => i.file === file);
  if (!image) return undefined;
  const width = Number(requestedWidth ?? BLOG_IMAGE_WIDTHS[0]);
  const allowed = BLOG_IMAGE_WIDTHS.map((w) => Math.min(w, image.width));
  if (!allowed.includes(width)) return undefined;
  return { image, dimension: getThumbnailDimension(image, width) };
}
