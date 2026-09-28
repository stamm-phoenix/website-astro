import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItem,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import { addListItemAttachment, deleteListItemAttachment } from '../lib/sharepoint-rest';
import type { BlogEntry } from '../lib/blog-list';
import {
  findImage,
  getBlogEntries,
  getBlogEntry,
  getBlogListId,
  getPlainText,
  serializeImages,
} from '../lib/blog-list';
import type { BlogImage, BlogPostInput } from '../lib/pflege-validation';
import {
  MAX_BLOG_IMAGE_BYTES,
  MAX_BLOG_IMAGES,
  validateBlogImages,
  validateBlogPost,
} from '../lib/pflege-validation';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import { fetchSharePointImage, getJpegSize, isJpeg } from '../lib/sharepoint-images';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

function toFields(input: BlogPostInput): Record<string, unknown> {
  return {
    Title: input.title,
    Datum: input.date,
    Veroeffentlicht: input.published,
    InhaltHtml: input.content,
  };
}

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

/** The current etag of a post, after a change that did not return it. */
async function currentEtag(id: string): Promise<string> {
  const item = (await getSharePointListItem(getBlogListId(), id)) as { eTag?: string } | undefined;
  return item?.eTag ?? '';
}

/** Loads a post and rejects changes based on an outdated version (etag in `If-Match`). */
async function loadForChange(request: HttpRequest): Promise<BlogEntry | HttpResponseInit> {
  const entry = await getBlogEntry(request.params.id ?? '');
  if (!entry) return NOT_FOUND;
  const expected = readIfMatch(request);
  if (expected && entry.etag && expected !== entry.etag) return CONFLICT;
  return entry;
}

function isEntry(value: BlogEntry | HttpResponseInit): value is BlogEntry {
  return 'images' in value;
}

/** GET: all posts including drafts; POST: create a post (images are added afterwards). */
export const BlogCollectionEndpoint = pflegeHandler('blog', async (request: HttpRequest) => {
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
  const id = await createSharePointListItem(getBlogListId(), {
    ...toFields(input),
    Bilder: serializeImages([]),
  });
  return ok({ id, etag: await currentEtag(id) }, 201);
});

/** GET: a post for editing; PATCH: save it (optimistic locking via etag); DELETE: remove it. */
export const BlogItemEndpoint = pflegeHandler('blog', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;

  if (request.method === 'GET') {
    const entry = await getBlogEntry(id);
    return entry ? ok(toStaffPost(entry)) : NOT_FOUND;
  }
  if (request.method === 'DELETE') {
    // Attachments are deleted together with the item
    await deleteSharePointListItem(getBlogListId(), id, readIfMatch(request));
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
  await updateSharePointListItem(getBlogListId(), id, toFields(input), readEtag(body));
  return ok({ etag: await currentEtag(id) });
});

/** PUT: add the JPEG in the body as image; PATCH: save alt texts and order (cover first). */
export const BlogImagesEndpoint = pflegeHandler('blog-bilder', async (request: HttpRequest) => {
  const entry = await loadForChange(request);
  if (!isEntry(entry)) return entry;

  if (request.method === 'PATCH') {
    const body = await readJsonBody(request);
    const images = validateBlogImages(body, entry.images);
    await updateSharePointListItem(
      getBlogListId(),
      entry.id,
      { Bilder: serializeImages(images) },
      readEtag(body)
    );
    return ok({ etag: await currentEtag(entry.id), images });
  }
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;

  if (entry.images.length >= MAX_BLOG_IMAGES) {
    return errorResponse(
      400,
      'INVALID',
      `Ein Beitrag kann höchstens ${MAX_BLOG_IMAGES} Bilder haben.`
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BLOG_IMAGE_BYTES) {
    return errorResponse(413, 'TOO_LARGE', 'Das Bild ist zu groß (höchstens 4 MB).');
  }
  const size = isJpeg(bytes) ? getJpegSize(bytes) : undefined;
  if (!size) {
    return errorResponse(400, 'INVALID', 'Bitte ein Bild im JPEG-Format hochladen.');
  }

  // A new name per upload, so cached images and SharePoint thumbnails never go stale
  const image: BlogImage = { file: `bild-${Date.now()}.jpg`, alt: '', ...size };
  await addListItemAttachment(getBlogListId(), entry.id, image.file, bytes);
  const images = [...entry.images, image];
  await updateSharePointListItem(getBlogListId(), entry.id, { Bilder: serializeImages(images) });
  return ok({ etag: await currentEtag(entry.id), images, image }, 201);
});

/** GET: preview of an image, also of drafts; DELETE: remove the image. */
export const BlogImageEndpoint = pflegeHandler(
  'blog-bilder',
  async (request: HttpRequest, context: InvocationContext) => {
    if (request.method === 'GET') {
      const entry = await getBlogEntry(request.params.id ?? '');
      const found = entry && findImage(entry, request.params.file, request.query.get('w'));
      if (!entry || !found) return NOT_FOUND;
      return fetchSharePointImage(
        getBlogListId(),
        entry.id,
        found.image.file,
        found.dimension,
        context
      );
    }
    if (request.method !== 'DELETE') return METHOD_NOT_ALLOWED;

    const entry = await loadForChange(request);
    if (!isEntry(entry)) return entry;
    const file = request.params.file ?? '';
    if (!entry.images.some((image) => image.file === file)) return NOT_FOUND;

    // The column first: an attachment without entry is harmless, an entry without file is not
    const images = entry.images.filter((image) => image.file !== file);
    await updateSharePointListItem(getBlogListId(), entry.id, { Bilder: serializeImages(images) });
    await deleteListItemAttachment(getBlogListId(), entry.id, file);
    return ok({ etag: await currentEtag(entry.id), images });
  }
);

export const BlogCollection = withErrorHandling(BlogCollectionEndpoint);
export const BlogItem = withErrorHandling(BlogItemEndpoint);
export const BlogImages = withErrorHandling(BlogImagesEndpoint);
export const BlogImageItem = withErrorHandling(BlogImageEndpoint);
