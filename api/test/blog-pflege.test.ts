import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import {
  BlogCollection,
  BlogImageItem,
  BlogImages,
  BlogItem,
} from '../endpoints/intern-pflege-blog';
import { GetBlogEndpoint, GetBlogImage, GetBlogPost } from '../endpoints/blog';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const POST = {
  title: 'Sommerlager',
  date: '2026-08-14',
  published: false,
  content: '<p>Zwei Wochen im Zelt.</p>',
};

interface ImagesResult {
  etag: string;
  images: { file: string; alt: string; width: number; height: number }[];
  image?: { file: string };
}

/** Blob Storage in memory. */
function setup(t: TestContext): { context: InvocationContext; blobs: Map<string, Buffer> } {
  const blobs = new Map<string, Buffer>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlobs', async (prefix: string) => {
    const names = [...blobs.keys()].filter((name) => name.startsWith(prefix));
    for (const name of names) blobs.delete(name);
    return names.length;
  });
  const context = new InvocationContext({ functionName: 'blog-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return { context, blobs };
}

function request(
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  options: { etag?: string; query?: string } = {}
): HttpRequest {
  const headers: Record<string, string> = {
    'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
  };
  if (options.etag) headers['if-match'] = options.etag;
  let init: { string: string } | { bytes: Uint8Array } | undefined;
  if (body instanceof Uint8Array) {
    headers['content-type'] = 'image/jpeg';
    init = { bytes: body };
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init = { string: JSON.stringify(body) };
  }
  return new HttpRequest({
    url: `http://localhost/api/blog${options.query ?? ''}`,
    method,
    headers,
    params,
    body: init,
  });
}

function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#003056' } })
    .jpeg()
    .toBuffer();
}

async function createPost(context: InvocationContext): Promise<{ id: string; etag: string }> {
  const response = await BlogCollection(request('POST', {}, POST), context);
  assert.equal(response.status, 201);
  return response.jsonBody as { id: string; etag: string };
}

dbTest(
  'posts are created, edited with their version and only published ones are public',
  async (t) => {
    const { context } = setup(t);
    const { id, etag } = await createPost(context);
    assert.match(etag, /^"[0-9a-f]{16}"$/);
    assert.deepEqual((await GetBlogEndpoint()).jsonBody, []);
    assert.equal((await GetBlogPost(request('GET', { id }), context)).status, 404);

    const save = (version: string) =>
      BlogItem(request('PATCH', { id }, { ...POST, published: true, etag: version }), context);
    const saved = await save(etag);
    assert.equal(saved.status, 200);
    const stale = await save(etag);
    assert.equal(stale.status, 409);

    const list = (await GetBlogEndpoint()).jsonBody as {
      id: string;
      title: string;
      date: string;
    }[];
    assert.deepEqual(
      list.map(({ id: postId, title, date }) => ({ id: postId, title, date })),
      [{ id, title: POST.title, date: POST.date }]
    );
    const post = (await GetBlogPost(request('GET', { id }), context)).jsonBody as {
      content: string;
    };
    assert.equal(post.content, POST.content);

    const staff = await BlogItem(request('GET', { id }), context);
    assert.equal(
      (staff.jsonBody as { etag: string }).etag,
      (saved.jsonBody as { etag: string }).etag
    );
  }
);

dbTest(
  'uploaded images are stored in the offered widths and served for published posts',
  async (t) => {
    const { context, blobs } = setup(t);
    const { id, etag } = await createPost(context);

    const upload = await BlogImages(
      request('PUT', { id }, await jpeg(2000, 1000), { etag }),
      context
    );
    assert.equal(upload.status, 201);
    const { image, images, etag: afterUpload } = upload.jsonBody as ImagesResult;
    assert.ok(image);
    assert.deepEqual(images, [{ file: image.file, alt: '', width: 2000, height: 1000 }]);
    assert.notEqual(afterUpload, etag);
    assert.deepEqual([...blobs.keys()].sort(), [
      `blog/${id}/${image.file}/1600.jpg`,
      `blog/${id}/${image.file}/800.jpg`,
    ]);
    assert.equal(
      (await sharp(blobs.get(`blog/${id}/${image.file}/800.jpg`)).metadata()).width,
      800
    );

    // A small image is stored once, at its own width
    const small = await BlogImages(
      request('PUT', { id }, await jpeg(600, 400), { etag: afterUpload }),
      context
    );
    const smallImage = (small.jsonBody as ImagesResult).image;
    assert.ok(smallImage);
    assert.equal(blobs.has(`blog/${id}/${smallImage.file}/600.jpg`), true);

    // Drafts show their images only in the Leitendenbereich
    const params = { id, file: image.file };
    assert.equal(
      (await GetBlogImage(request('GET', params, undefined, { query: '?w=800' }), context)).status,
      404
    );
    assert.equal(
      (await BlogImageItem(request('GET', params, undefined, { query: '?w=800' }), context)).status,
      200
    );

    const current = (await BlogItem(request('GET', { id }), context)).jsonBody as { etag: string };
    await BlogItem(
      request('PATCH', { id }, { ...POST, published: true, etag: current.etag }),
      context
    );
    for (const [width, status] of [
      ['800', 200],
      ['1600', 200],
      ['1000', 404],
    ] as const) {
      const response = await GetBlogImage(
        request('GET', params, undefined, { query: `?w=${width}` }),
        context
      );
      assert.equal(response.status, status);
      if (status === 200) {
        assert.equal((response.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
        assert.equal(
          (response.headers as Record<string, string>)['Cache-Control'],
          'private, max-age=3600'
        );
      }
    }
  }
);

dbTest('image order and alt texts are saved with the version of the post', async (t) => {
  const { context } = setup(t);
  const { id, etag } = await createPost(context);
  const first = (await BlogImages(request('PUT', { id }, await jpeg(100, 100), { etag }), context))
    .jsonBody as ImagesResult;
  const second = (
    await BlogImages(request('PUT', { id }, await jpeg(200, 100), { etag: first.etag }), context)
  ).jsonBody as ImagesResult;

  const reordered = [
    { ...second.images[1], alt: 'Lagerfeuer' },
    { ...second.images[0], alt: 'Zelte' },
  ];
  const stale = await BlogImages(
    request('PATCH', { id }, { images: reordered, etag: first.etag }),
    context
  );
  assert.equal(stale.status, 409);
  const saved = await BlogImages(
    request('PATCH', { id }, { images: reordered, etag: second.etag }),
    context
  );
  assert.equal(saved.status, 200);
  const loaded = (await BlogItem(request('GET', { id }), context)).jsonBody as ImagesResult;
  assert.deepEqual(loaded.images, reordered);
  assert.equal(loaded.etag, (saved.jsonBody as ImagesResult).etag);
});

dbTest('deleting an image or a post removes its files', async (t) => {
  const { context, blobs } = setup(t);
  const { id, etag } = await createPost(context);
  const uploaded = (
    await BlogImages(request('PUT', { id }, await jpeg(900, 600), { etag }), context)
  ).jsonBody as ImagesResult;
  const file = uploaded.images[0].file;

  // A stale upload is refused and leaves no files behind
  const staleUpload = await BlogImages(
    request('PUT', { id }, await jpeg(900, 600), { etag }),
    context
  );
  assert.equal(staleUpload.status, 409);
  assert.equal(
    [...blobs.keys()].every((name) => name.startsWith(`blog/${id}/${file}/`)),
    true
  );

  const removed = await BlogImageItem(
    request('DELETE', { id, file }, undefined, { etag: uploaded.etag }),
    context
  );
  assert.equal(removed.status, 200);
  assert.deepEqual((removed.jsonBody as ImagesResult).images, []);
  assert.equal(blobs.size, 0);

  const again = (
    await BlogImages(
      request('PUT', { id }, await jpeg(900, 600), {
        etag: (removed.jsonBody as ImagesResult).etag,
      }),
      context
    )
  ).jsonBody as ImagesResult;
  assert.equal(blobs.size, 2);
  assert.equal(
    (await BlogItem(request('DELETE', { id }, undefined, { etag }), context)).status,
    409
  );
  assert.equal(
    (await BlogItem(request('DELETE', { id }, undefined, { etag: again.etag }), context)).status,
    204
  );
  assert.equal(blobs.size, 0);
  assert.equal((await BlogItem(request('GET', { id }), context)).status, 404);
});

dbTest('uploads must be JPEGs for an existing post', async (t) => {
  const { context, blobs } = setup(t);
  const { id } = await createPost(context);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  assert.equal((await BlogImages(request('PUT', { id }, png), context)).status, 400);
  assert.equal(blobs.size, 0);
  assert.equal(
    (await BlogImages(request('PUT', { id: '999999' }, await jpeg(10, 10)), context)).status,
    404
  );
});

dbTest('images beyond the stored size limit are refused before any file is written', async (t) => {
  const { context, blobs } = setup(t);
  const { id } = await createPost(context);
  const response = await BlogImages(request('PUT', { id }, await jpeg(10001, 10)), context);
  assert.equal(response.status, 400);
  assert.match((response.jsonBody as { message: string }).message, /10000 Pixel/);
  assert.equal(blobs.size, 0);
});

dbTest('a failed file upload leaves neither files nor an image entry behind', async (t) => {
  const { context, blobs } = setup(t);
  const { id } = await createPost(context);
  let calls = 0;
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    if (++calls === 2) throw new Error('storage unavailable');
    blobs.set(name, Buffer.from(bytes));
  });
  const response = await BlogImages(request('PUT', { id }, await jpeg(2000, 1000)), context);
  assert.equal(response.status, 500);
  assert.equal(blobs.size, 0);
  const post = (await BlogItem(request('GET', { id }), context)).jsonBody as ImagesResult;
  assert.deepEqual(post.images, []);
});
