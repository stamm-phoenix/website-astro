/**
 * Sanitizing of the formatted text of the edit modules (FAQ answers, descriptions, blog posts).
 * This is no schema validation: the validators call it from their transforms and then check
 * the length of the result.
 */

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'div']);
/** Additional tags of blog posts; `img` keeps one checked attribute. */
const BLOG_TAGS = new Set(['h2', 'h3', 'img']);
/** Tags whose content is dropped together with the tag. */
const DROPPED_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'template',
  'textarea',
]);
/** A tag or comment; everything between two matches is text. */
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>?/g;

/** File name of an image attached to a blog post, as created by the upload. */
export const BLOG_IMAGE_FILE = /^bild-\d{1,16}\.jpg$/;
/** Link targets allowed in blog posts and FAQ answers: http(s) and mailto only. */
const SAFE_URL = /^(?:https?:\/\/[^\s"'<>`]+|mailto:[^\s"'<>`/:]+@[^\s"'<>`]+)$/i;

export interface SanitizedRichText {
  html: string;
  /** Number of visible text characters (entities counted as written). */
  textLength: number;
  /** Whether text tokens contain more than whitespace or empty editor placeholders. */
  hasVisibleText: boolean;
}

/** Extra content allowed beyond the formatting tags. */
export interface SanitizeOptions {
  /** Keeps links (`href` with http(s) or mailto only); used by blog posts and FAQ answers. */
  links?: boolean;
  /** Blog posts: headings and these images of the post; other images are dropped. */
  blog?: { images: Set<string> };
}

function escapeText(text: string): string {
  return text
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Decoded value of an attribute in the source of a start tag; undefined if missing. */
function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\`]+))`, 'i').exec(
    tag
  );
  if (!match) return undefined;
  return decodeAttribute((match[1] ?? match[2] ?? match[3] ?? '').trim());
}

/**
 * Reduces HTML to a small set of formatting tags without any attributes, in a single pass:
 * text between tags is escaped and allowed tags are written anew, so every `<` in the result
 * comes from a tag created here. Mirrors `sanitizeDescription` in the frontend.
 *
 * With `links`, links (`href` with http(s) or mailto only) are kept as well; with `blog`,
 * headings and images of the post (`data-bild` with the file name only). Mirrors
 * `toCanonicalBlogHtml` and `sanitizeDescription` with links.
 */
export function sanitize(
  html: string,
  { links: keepLinks, blog }: SanitizeOptions = {}
): SanitizedRichText {
  let output = '';
  let textLength = 0;
  let hasVisibleText = false;
  /** Name of the tag whose content is currently being dropped. */
  let dropping: string | null = null;
  /** Per open `<a>`, whether it was written; closing tags of dropped links are dropped too. */
  const links: boolean[] = [];
  let last = 0;

  const addText = (text: string): void => {
    if (dropping || !text) return;
    output += escapeText(text);
    textLength += text.trim() ? text.length : 0;
    hasVisibleText ||= Boolean(
      text
        .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
    );
  };

  for (const match of html.matchAll(TOKEN)) {
    addText(html.slice(last, match.index));
    last = match.index + match[0].length;

    const name = match[2]?.toLowerCase();
    if (!name) continue; // comment
    const closing = match[1] === '/';

    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (!closing && DROPPED_WITH_CONTENT.has(name)) {
      dropping = name;
      continue;
    }
    if (keepLinks && name === 'a') {
      if (closing) {
        if (links.pop()) output += '</a>';
        continue;
      }
      const href = readAttribute(match[0], 'href');
      const valid = href !== undefined && SAFE_URL.test(href);
      links.push(valid);
      if (valid) output += `<a href="${escapeAttribute(href)}">`;
      continue;
    }
    if (blog && name === 'img') {
      const file = readAttribute(match[0], 'data-bild');
      if (!closing && file && BLOG_IMAGE_FILE.test(file) && blog.images.has(file)) {
        output += `<img data-bild="${file}">`;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name) && !(blog && BLOG_TAGS.has(name))) continue;
    if (name === 'br') output += closing ? '' : '<br>';
    else output += closing ? `</${name}>` : `<${name}>`;
  }
  addText(html.slice(last));
  while (links.length > 0) if (links.pop()) output += '</a>';

  return { html: output.trim(), textLength, hasVisibleText };
}

/** The sanitized HTML together with its number of visible characters; see `sanitize`. */
export function sanitizeRichTextWithLength(html: string): SanitizedRichText {
  return sanitize(html);
}

/** The sanitized HTML; see `sanitize`. */
export function sanitizeRichText(html: string): string {
  return sanitize(html).html;
}

/** Sanitized HTML of a blog post; images not in `images` are dropped. See `sanitize`. */
export function sanitizeBlogHtml(html: string, images: Iterable<string>): SanitizedRichText {
  return sanitize(html, { links: true, blog: { images: new Set(images) } });
}
