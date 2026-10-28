/** Validation of blog posts and of the alt texts and order of their images. */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { sanitizeBlogHtml } from './rich-text';
import { labeledText, lenientObject, parseWith } from './zod';

const MAX_BLOG_TEXT_LENGTH = 20000;
/** Plain multi-line text columns hold at most 63 999 characters. */
const MAX_BLOG_HTML_LENGTH = 60000;
const MAX_ALT_LENGTH = 300;
export const MAX_BLOG_IMAGES = 30;
export const MAX_BLOG_IMAGE_BYTES = 4 * 1024 * 1024;
/** Longest side of an uploaded image (`content.blog_image`, `ck_blog_image_width/height`). */
export const MAX_BLOG_IMAGE_SIDE = 10000;

/** An image attached to a blog post; the first one is the cover image. */
export interface BlogImage {
  file: string;
  alt: string;
  width: number;
  height: number;
}

export interface BlogPostInput {
  title: string;
  /** Date of the post as `YYYY-MM-DD`. */
  date: string;
  published: boolean;
  /** Canonical HTML, see `sanitizeBlogHtml`. */
  content: string;
}

const DATE_MESSAGE = 'Bitte ein gültiges Datum angeben.';

function blogPostSchema(images: string[]) {
  return lenientObject({
    title: labeledText('einen Titel', 255, true),
    date: z.string({ error: DATE_MESSAGE }).refine(isValidDate, { error: DATE_MESSAGE }),
    published: z.boolean({ error: 'Der Status ist ungültig.' }).optional(),
    // A missing or foreign content is no error: it is read as an empty text
    content: z
      .unknown()
      .optional()
      .transform((raw, ctx) => {
        const sanitized = sanitizeBlogHtml(typeof raw === 'string' ? raw : '', images);
        if (sanitized.textLength > MAX_BLOG_TEXT_LENGTH) {
          ctx.issues.push({
            code: 'custom',
            input: raw,
            message: `Der Text darf höchstens ${MAX_BLOG_TEXT_LENGTH} Zeichen lang sein.`,
          });
        } else if (sanitized.html.length > MAX_BLOG_HTML_LENGTH) {
          ctx.issues.push({
            code: 'custom',
            input: raw,
            message: 'Der Text ist zu lang, bitte kürzen oder aufteilen.',
          });
        }
        return sanitized.html;
      }),
  }).transform(({ title, date, published, content }): BlogPostInput => ({
    title,
    date,
    published: published === true,
    content,
  }));
}

/**
 * Validates a blog post.
 * @param images File names of the images of the post; other images are removed from the text.
 */
export function validateBlogPost(body: unknown, images: string[]): BlogPostInput {
  return parseWith(blogPostSchema(images), body);
}

const IMAGES_CHANGED = 'Die Bilder haben sich inzwischen geändert. Bitte neu laden.';

/** The images of a post as the browser knows them: every file once, with its new alt text. */
function blogImagesSchema(current: BlogImage[]) {
  const byFile = new Map(current.map((image) => [image.file, image]));
  const seen = new Set<string>();
  const entry = lenientObject({
    file: z
      .unknown()
      .optional()
      .transform((value) => (typeof value === 'string' ? value : ''))
      .refine((file) => byFile.has(file) && !seen.has(file) && Boolean(seen.add(file)), {
        error: IMAGES_CHANGED,
      }),
    // Anything but text is read as no description
    alt: z
      .unknown()
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''))
      .refine((alt) => alt.length <= MAX_ALT_LENGTH, {
        error: `Eine Bildbeschreibung darf höchstens ${MAX_ALT_LENGTH} Zeichen lang sein.`,
      }),
  }).transform(({ file, alt }): BlogImage => ({ ...(byFile.get(file) as BlogImage), alt }));
  return lenientObject({
    images: z
      .array(z.unknown(), { error: IMAGES_CHANGED })
      .length(current.length, { error: IMAGES_CHANGED })
      .pipe(z.array(entry)),
  });
}

/**
 * Validates new alt texts and a new order of the existing images of a post.
 * @param current The images as stored; files cannot be added or removed here.
 */
export function validateBlogImages(body: unknown, current: BlogImage[]): BlogImage[] {
  return parseWith(blogImagesSchema(current), body).images;
}
