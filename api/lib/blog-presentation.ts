import type { BlogImage } from './validation/blog';
import type { BlogEntry } from './blog-list';
import { escapeAttribute } from './validation/rich-text';
export const BLOG_IMAGE_WIDTHS = [800, 1600];
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
    if (/^<\/?(?:p|div|h[1-6]|ul|ol|li|br|img)\b/i.test(match[0])) text += ' ';
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
