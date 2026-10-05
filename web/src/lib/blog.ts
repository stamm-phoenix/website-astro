import { TEXT_NODE, isElement, parseHtml } from './html';
import type { BlogImage } from './types';

/**
 * Helpers for blog posts. The content is stored as canonical HTML: a few formatting tags,
 * `<a href>` with http(s)/mailto links and `<img data-bild="…">` placeholders for the images
 * attached to the post. The API checks it again (`sanitizeBlogHtml` in
 * `api/lib/pflege-validation.ts`) and replaces the placeholders with complete image tags.
 */

/** File name of an image attached to a blog post, as created by the upload. */
export const BLOG_IMAGE_FILE = /^bild-\d{1,16}\.jpg$/;
/** Link targets allowed in blog posts; mirrors `SAFE_URL` in the API. */
export const SAFE_URL = /^(?:https?:\/\/[^\s"'<>`]+|mailto:[^\s"'<>`/:]+@[^\s"'<>`]+)$/i;
/** Width of the image previews in the Leitendenbereich; one of the widths the API serves. */
const PREVIEW_WIDTH = 800;

const FORMATTING_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'div',
  'h2',
  'h3',
]);
/** Tags whose content is dropped together with the tag. */
const DROPPED_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'template',
  'textarea',
  'noscript',
]);

/** Static page of a published post, baked at build time. */
export function getBlogPostUrl(id: string): string {
  return `/blog/${encodeURIComponent(id)}/`;
}

/** Preview of an image in the Leitendenbereich; also works for drafts. */
export function getStaffBlogImageUrl(postId: string, image: BlogImage): string {
  const width = Math.min(PREVIEW_WIDTH, image.width);
  return `/api/intern/pflege/blog/${postId}/bilder/${image.file}?w=${width}`;
}

/** Date of a post as `29. September 2026`. */
export function formatBlogDate(date: string): string {
  if (!date) return '';
  return new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Turns user input into a link target: adds `https://` to bare domains and `mailto:` to
 * e-mail addresses. Returns null if the result is not an allowed link.
 */
export function normalizeLinkUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(url)) url = `mailto:${url}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  return SAFE_URL.test(url) ? url : null;
}

type Mode = 'canonical' | 'public';

function isPublicImageUrl(url: string): boolean {
  return /^\/api\/blog\/\d+\/bilder\/bild-\d{1,16}\.jpg\?w=\d{1,4}$/.test(url);
}

/** Copies an allowed image; returns null for images that are not ours. */
function cleanImage(source: HTMLElement, mode: Mode, doc: Document): HTMLElement | null {
  const image = doc.createElement('img');
  if (mode === 'canonical') {
    const file = source.getAttribute('data-bild') ?? '';
    if (!BLOG_IMAGE_FILE.test(file)) return null;
    image.setAttribute('data-bild', file);
    return image;
  }

  const src = source.getAttribute('src') ?? '';
  if (!isPublicImageUrl(src)) return null;
  image.setAttribute('src', src);
  const srcset = source.getAttribute('srcset') ?? '';
  const candidates = srcset.split(',').map((part) => part.trim().split(/\s+/));
  if (candidates.every(([url, width]) => isPublicImageUrl(url) && /^\d{1,4}w$/.test(width ?? ''))) {
    image.setAttribute('srcset', srcset);
    image.setAttribute('sizes', source.getAttribute('sizes') ?? '100vw');
  }
  image.setAttribute('alt', source.getAttribute('alt') ?? '');
  for (const name of ['width', 'height']) {
    const value = source.getAttribute(name) ?? '';
    if (/^\d{1,5}$/.test(value)) image.setAttribute(name, value);
  }
  image.setAttribute('loading', 'lazy');
  image.setAttribute('decoding', 'async');
  return image;
}

function cleanChildren(source: Node, target: Node, mode: Mode, doc: Document): void {
  for (const child of Array.from(source.childNodes)) {
    for (const clean of cleanNode(child, mode, doc)) target.appendChild(clean);
  }
}

/** Clean copies of a node; disallowed tags are replaced by their cleaned content. */
function cleanNode(node: Node, mode: Mode, doc: Document): Node[] {
  if (node.nodeType === TEXT_NODE) {
    const text = node.textContent?.replace(/[\u200B-\u200D\uFEFF]/g, '') ?? '';
    return text ? [doc.createTextNode(text)] : [];
  }
  if (!isElement(node)) return [];

  const element = node;
  const tag = element.tagName.toLowerCase();
  if (DROPPED_WITH_CONTENT.has(tag)) return [];

  if (tag === 'img') {
    const image = cleanImage(element, mode, doc);
    return image ? [image] : [];
  }

  let clean: HTMLElement;
  if (tag === 'a') {
    const href = element.getAttribute('href') ?? '';
    if (!SAFE_URL.test(href)) {
      const fragment = doc.createDocumentFragment();
      cleanChildren(element, fragment, mode, doc);
      return Array.from(fragment.childNodes);
    }
    clean = doc.createElement('a');
    clean.setAttribute('href', href);
    if (mode === 'public') clean.setAttribute('rel', 'noopener noreferrer');
  } else if (FORMATTING_TAGS.has(tag)) {
    clean = doc.createElement(tag);
  } else {
    const fragment = doc.createDocumentFragment();
    cleanChildren(element, fragment, mode, doc);
    return Array.from(fragment.childNodes);
  }

  cleanChildren(element, clean, mode, doc);
  // Empty elements (e.g. blank paragraphs) are dropped, unless they contain an image
  if (tag !== 'br' && !clean.textContent?.trim() && !clean.querySelector('img')) return [];
  return [clean];
}

/** Elements that stand on their own at the top level; everything else goes into paragraphs. */
const TOP_LEVEL_BLOCKS = new Set(['p', 'div', 'h2', 'h3', 'ul', 'ol', 'img']);

/**
 * Wraps text and inline elements at the top level into `<p>`: contenteditable leaves the
 * first line without a paragraph, which would otherwise get no spacing.
 */
function wrapInlineRuns(container: HTMLElement, doc: Document): void {
  let paragraph: HTMLElement | null = null;
  for (const node of Array.from(container.childNodes)) {
    const tag = isElement(node) ? node.tagName.toLowerCase() : '';
    if (TOP_LEVEL_BLOCKS.has(tag)) {
      paragraph = null;
      continue;
    }
    if (!paragraph) {
      if (node.nodeType === TEXT_NODE && !node.textContent?.trim()) continue;
      paragraph = doc.createElement('p');
      container.insertBefore(paragraph, node);
    }
    paragraph.appendChild(node);
  }
}

function clean(html: string, mode: Mode): string {
  if (!html) return '';
  // Also runs during the build, where there is no browser DOM
  const doc = parseHtml(html);
  const result = doc.createElement('div');
  cleanChildren(doc.body, result, mode, doc);
  if (!result.textContent?.trim() && !result.querySelector('img')) return '';
  wrapInlineRuns(result, doc);
  return result.innerHTML;
}

/** Canonical HTML as stored; mirrors `sanitizeBlogHtml` in the API. */
export function toCanonicalBlogHtml(html: string): string {
  return clean(html, 'canonical');
}

/** Content of a published post as delivered by the API, checked again before display. */
export function sanitizeBlogContent(html: string): string {
  return clean(html, 'public');
}

/**
 * Canonical HTML for the editor: the image placeholders get a preview `src`, which
 * `toCanonicalBlogHtml` removes again. Images unknown to `images` are dropped.
 */
export function toEditorHtml(html: string, postId: string, images: BlogImage[]): string {
  const doc = new DOMParser().parseFromString(toCanonicalBlogHtml(html), 'text/html');
  for (const element of Array.from(doc.body.querySelectorAll('img[data-bild]'))) {
    const image = images.find((i) => i.file === element.getAttribute('data-bild'));
    if (image) {
      element.setAttribute('src', getStaffBlogImageUrl(postId, image));
      element.setAttribute('alt', image.alt);
    } else {
      element.remove();
    }
  }
  return doc.body.innerHTML;
}

/** File names of the images used in canonical HTML. */
export function getUsedImages(html: string): Set<string> {
  return new Set(Array.from(html.matchAll(/data-bild="([^"]+)"/g), (match) => match[1]));
}

/** Scales an image to fit into `maxSize` × `maxSize` and encodes it as JPEG. */
export async function toScaledJpeg(file: File, maxSize: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not available');
  // White instead of black behind transparent areas (PNG)
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.85
    )
  );
}
