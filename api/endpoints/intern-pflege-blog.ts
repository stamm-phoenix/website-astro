import { randomInt } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { BlogEntry } from '../lib/blog-list';
import {
  TooManyImagesError,
  addBlogImage,
  createBlogPost,
  deleteBlogPost,
  findImage,
  getBlogEntries,
  getBlogEntry,
  getPlainText,
  removeBlogImage,
  saveBlogImages,
  updateBlogPost,
} from '../lib/blog-list';
import {
  deleteBlogImageFiles,
  deleteBlogPostFiles,
  serveBlogImage,
  storeBlogImageFiles,
} from '../lib/blog-images';
import type { BlogImage } from '../lib/pflege-validation';
import {
  MAX_BLOG_IMAGE_BYTES,
  MAX_BLOG_IMAGES,
  validateBlogImages,
  validateBlogPost,
} from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import { getJpegSize, isJpeg } from '../lib/sharepoint-images';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const TOO_MANY_IMAGES = errorResponse(
  400,
  'INVALID',
  `Ein Beitrag kann höchstens ${MAX_BLOG_IMAGES} Bilder haben.`
);

/** A post as the editor needs it. */
function toStaffPost(entry: BlogEntry): unknown {
  return {
    id: entry.id,
    etag: entry.etag,
    title: entry.title,
    date: entry.date,
    published: entry.published,
    content: entry.content,
    images: entry.images,
  };
}

/** GET: all posts including drafts; POST: create a post (images are added afterwards). */
export const BlogCollectionEndpoint = pflegeHandler(
  'blog',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const entries = await getBlogEntries();
      return ok(
        entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          date: entry.date,
          published: entry.published,
          cover: entry.images[0] ?? null,
          imageCount: entry.images.length,
          textLength: getPlainText(entry.content).length,
        }))
      );
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateBlogPost(await readJsonBody(request), []);
    return ok(await createBlogPost(input, principal.userDetails), 201);
  }
);

/** GET: a post for editing; PATCH: save it (optimistic locking via etag); DELETE: remove it. */
export const BlogItemEndpoint = pflegeHandler(
  'blog',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'GET') {
      const entry = await getBlogEntry(id);
      return entry ? ok(toStaffPost(entry)) : NOT_FOUND;
    }
    if (request.method === 'DELETE') {
      await deleteBlogPost(id, readIfMatch(request));
      // After the rows: files without a post are harmless and removed again with the next try
      await deleteBlogPostFiles(id);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const entry = await getBlogEntry(id);
    if (!entry) return NOT_FOUND;
    const body = await readJsonBody(request);
    const input = validateBlogPost(
      body,
      entry.images.map((image) => image.file)
    );
    return ok({ etag: await updateBlogPost(id, input, readEtag(body), principal.userDetails) });
  }
);

/** PUT: add the JPEG in the body as image; PATCH: save alt texts and order (cover first). */
export const BlogImagesEndpoint = pflegeHandler(
  'blog-bilder',
  async (request: HttpRequest, _context, principal) => {
    const entry = await getBlogEntry(request.params.id ?? '');
    if (!entry) return NOT_FOUND;

    if (request.method === 'PATCH') {
      const body = await readJsonBody(request);
      const images = validateBlogImages(body, entry.images);
      return ok(await saveBlogImages(entry.id, images, readEtag(body), principal.userDetails));
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;

    if (entry.images.length >= MAX_BLOG_IMAGES) return TOO_MANY_IMAGES;
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BLOG_IMAGE_BYTES) {
      return errorResponse(413, 'TOO_LARGE', 'Das Bild ist zu groß (höchstens 4 MB).');
    }
    const size = isJpeg(bytes) ? getJpegSize(bytes) : undefined;
    if (!size) {
      return errorResponse(400, 'INVALID', 'Bitte ein Bild im JPEG-Format hochladen.');
    }

    // A new name per upload, so cached images never go stale; the random digits keep two
    // uploads in the same millisecond apart. The files first: files without an entry are
    // harmless, an entry without files is not.
    const suffix = String(randomInt(1000)).padStart(3, '0');
    const image: BlogImage = { file: `bild-${Date.now()}${suffix}.jpg`, alt: '', ...size };
    await storeBlogImageFiles(entry.id, image, bytes);
    try {
      const result = await addBlogImage(
        entry.id,
        image,
        readIfMatch(request),
        principal.userDetails
      );
      return ok({ ...result, image }, 201);
    } catch (error: unknown) {
      await deleteBlogImageFiles(entry.id, image.file);
      if (error instanceof TooManyImagesError) return TOO_MANY_IMAGES;
      throw error;
    }
  }
);

/** GET: preview of an image, also of drafts; DELETE: remove the image. */
export const BlogImageEndpoint = pflegeHandler(
  'blog-bilder',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    const file = request.params.file ?? '';
    if (request.method === 'GET') {
      const entry = await getBlogEntry(id);
      const found = entry && findImage(entry, file, request.query.get('w'));
      if (!entry || !found) return NOT_FOUND;
      return (await serveBlogImage(entry.id, found.image.file, found.width)) ?? NOT_FOUND;
    }
    if (request.method !== 'DELETE') return METHOD_NOT_ALLOWED;

    // The entry first: an image without entry is harmless, an entry without image is not
    const result = await removeBlogImage(id, file, readIfMatch(request), principal.userDetails);
    await deleteBlogImageFiles(id, file);
    return ok(result);
  }
);

export const BlogCollection = withErrorHandling(BlogCollectionEndpoint);
export const BlogItem = withErrorHandling(BlogItemEndpoint);
export const BlogImages = withErrorHandling(BlogImagesEndpoint);
export const BlogImageItem = withErrorHandling(BlogImageEndpoint);
