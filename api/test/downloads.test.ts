import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { Client } from '@microsoft/microsoft-graph-client';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { getDb } from '../lib/db';
import { seedPreviewDownloads } from '../lib/db-preview';
import { copyDownloads } from '../lib/download-import';
import { deleteOrphanedDownloadFiles, listDownloads } from '../lib/downloads';
import { UPLOAD_PART_BYTES } from '../lib/pflege-validation';
import * as token from '../lib/token';
import { GetDownloadFilesEndpoint } from '../endpoints/download-files';
import { GetDownloadFileEndpointInternal } from '../endpoints/download-file';
import { GetDownloadFileImageEndpointInternal } from '../endpoints/download-file-image';
import {
  DownloadItem,
  DownloadUploadComplete,
  DownloadUploadPart,
  DownloadUploadStart,
  DownloadsCollection,
} from '../endpoints/intern-pflege-downloads';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

interface Storage {
  context: InvocationContext;
  blobs: Map<string, Buffer>;
  times: Map<string, Date>;
}

/** Blob Storage in memory, with staged parts, a quiet context and no downloads yet. */
async function setup(t: TestContext): Promise<Storage> {
  await getDb().deleteFrom('content.download').execute();
  await getDb().deleteFrom('content.sharepoint_import').where('list', '=', 'downloads').execute();
  const blobs = new Map<string, Buffer>();
  const times = new Map<string, Date>();
  const staged = new Map<string, Map<number, Buffer>>();
  const store = (name: string, bytes: Uint8Array): void => {
    blobs.set(name, Buffer.from(bytes));
    times.set(name, new Date());
  };
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) =>
    store(name, bytes)
  );
  t.mock.method(blobStorage, 'putBlobStream', async (name: string, stream: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    store(name, Buffer.concat(chunks));
  });
  t.mock.method(
    blobStorage,
    'stageBlobPart',
    async (name: string, index: number, bytes: Uint8Array) => {
      const parts = staged.get(name) ?? new Map<number, Buffer>();
      parts.set(index, Buffer.from(bytes));
      staged.set(name, parts);
    }
  );
  t.mock.method(blobStorage, 'listStagedParts', async (name: string) =>
    [...(staged.get(name) ?? new Map<number, Buffer>()).entries()]
      .map(([index, bytes]) => ({ index, size: bytes.length }))
      .sort((a, b) => a.index - b.index)
  );
  t.mock.method(blobStorage, 'commitStagedBlob', async (name: string, count: number) => {
    if (blobs.has(name)) return false;
    const parts = staged.get(name)!;
    store(name, Buffer.concat(Array.from({ length: count }, (_, index) => parts.get(index)!)));
    staged.delete(name);
    return true;
  });
  t.mock.method(blobStorage, 'openBlob', async (name: string) => {
    const bytes = blobs.get(name);
    return bytes && { stream: Readable.from([bytes]), size: bytes.length };
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: times.get(name) ?? new Date() }))
  );
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'deleteBlobs', async (prefix: string) => {
    const names = [...blobs.keys()].filter((name) => name.startsWith(prefix));
    for (const name of names) blobs.delete(name);
    return names.length;
  });
  t.mock.method(console, 'log', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
  const context = new InvocationContext({ functionName: 'downloads-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return { context, blobs, times };
}

function request(method: string, params: Record<string, string> = {}, body?: unknown): HttpRequest {
  const headers: Record<string, string> = {
    'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
  };
  let init: { string: string } | { bytes: Uint8Array } | undefined;
  if (body instanceof Uint8Array) {
    headers['content-type'] = 'application/octet-stream';
    init = { bytes: body };
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init = { string: JSON.stringify(body) };
  }
  return new HttpRequest({ url: 'http://localhost/api/test', method, headers, params, body: init });
}

function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#003056' } })
    .jpeg()
    .toBuffer();
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface UploadOptions {
  replace?: boolean;
  preview?: Buffer;
}

/** Uploads a file the way the browser does: start, parts, complete. */
async function upload(
  { context }: Storage,
  fileName: string,
  bytes: Buffer,
  options: UploadOptions = {}
): Promise<{ status: number; jsonBody: unknown; uploadId?: string }> {
  const start = await DownloadUploadStart(
    request('POST', {}, { fileName, size: bytes.length, replace: options.replace === true }),
    context
  );
  if (start.status !== 200) return { status: start.status ?? 200, jsonBody: start.jsonBody };
  const { uploadId, partSize } = start.jsonBody as { uploadId: string; partSize: number };
  for (let offset = 0, index = 0; offset < bytes.length; offset += partSize, index++) {
    const part = await DownloadUploadPart(
      request('PUT', { uploadId, index: String(index) }, bytes.subarray(offset, offset + partSize)),
      context
    );
    assert.equal(part.status, 204);
  }
  const done = await DownloadUploadComplete(
    request(
      'POST',
      { uploadId },
      {
        fileName,
        replace: options.replace === true,
        preview: options.preview?.toString('base64'),
      }
    ),
    context
  );
  return { status: done.status ?? 200, jsonBody: done.jsonBody, uploadId };
}

dbTest('a file uploaded in parts is listed and served with its preview', async (t) => {
  const storage = await setup(t);
  const { context, blobs } = storage;
  const bytes = Buffer.alloc(UPLOAD_PART_BYTES + 10, 7);
  const saved = await upload(storage, 'Packliste Sommerlager.pdf', bytes, {
    preview: await jpeg(600, 840),
  });
  assert.equal(saved.status, 201);
  const { id } = saved.jsonBody as { id: string };

  const staff = (await DownloadsCollection(request('GET'), context)).jsonBody as {
    id: string;
    fileName: string;
    size: number;
    lastModifiedBy: string;
    hasPreview: boolean;
  }[];
  assert.deepEqual(
    staff.map((file) => [file.id, file.fileName, file.size, file.lastModifiedBy, file.hasPreview]),
    [[id, 'Packliste Sommerlager.pdf', bytes.length, 'staff@example.test', true]]
  );
  // The public list leaves out who uploaded the file
  const [publicFile] = (await GetDownloadFilesEndpoint()).jsonBody as Record<string, unknown>[];
  assert.equal(publicFile.mimeType, 'application/pdf');
  assert.equal(publicFile.hasPreview, true);
  assert.equal('lastModifiedBy' in publicFile || 'createdBy' in publicFile, false);

  const file = await GetDownloadFileEndpointInternal(request('GET', { id }), context);
  assert.equal(file.status, 200);
  const headers = file.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /attachment; filename="Packliste Sommerlager.pdf"/);
  assert.deepEqual(await bodyBytes(file.body), bytes);

  for (const [size, width] of [
    ['small', 128],
    ['medium', 400],
    ['large', 400],
  ] as const) {
    const image = await GetDownloadFileImageEndpointInternal(request('GET', { id, size }), context);
    assert.equal(image.status, 200);
    assert.equal((await sharp(await bodyBytes(image.body)).metadata()).width, width);
  }
  // The file and two previews, all in the folder of this version
  assert.equal(blobs.size, 3);
  const missing = await GetDownloadFileEndpointInternal(request('GET', { id: 'nope' }), context);
  assert.equal(missing.status, 404);
});

dbTest('the media type comes from the extension, never from the browser', async (t) => {
  const storage = await setup(t);
  const saved = await upload(storage, 'seite.html', Buffer.from('<script>alert(1)</script>'));
  const { id } = saved.jsonBody as { id: string };
  const file = await GetDownloadFileEndpointInternal(request('GET', { id }), storage.context);
  const headers = file.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.match(headers['Content-Disposition'], /^attachment;/);
});

dbTest('an existing name asks first, and replacing keeps the ID', async (t) => {
  const storage = await setup(t);
  const { context, blobs } = storage;
  const first = await upload(storage, 'Anmeldung.pdf', Buffer.from('erste Fassung'), {
    preview: await jpeg(100, 140),
  });
  const { id } = first.jsonBody as { id: string };

  // Start refuses the name, regardless of case
  const again = await upload(storage, 'anmeldung.PDF', Buffer.from('zweite Fassung'));
  assert.equal(again.status, 409);
  assert.equal((again.jsonBody as { code: string }).code, 'EXISTS');

  // Replacing keeps the ID and the link, and removes the old version with its previews
  const replaced = await upload(storage, 'anmeldung.PDF', Buffer.from('zweite Fassung'), {
    replace: true,
  });
  assert.equal(replaced.status, 201);
  assert.equal((replaced.jsonBody as { id: string }).id, id);
  const [file] = await listDownloads();
  assert.equal(file.fileName, 'anmeldung.PDF');
  assert.equal(file.hasPreview, false);
  assert.equal(blobs.size, 1);
  const served = await GetDownloadFileEndpointInternal(request('GET', { id }), context);
  assert.equal((await bodyBytes(served.body)).toString(), 'zweite Fassung');
});

dbTest('a name taken during the upload keeps the parts for „Ersetzen“', async (t) => {
  const storage = await setup(t);
  const { context } = storage;
  const start = await DownloadUploadStart(
    request('POST', {}, { fileName: 'Liste.pdf', size: 3 }),
    context
  );
  const { uploadId } = start.jsonBody as { uploadId: string };
  await DownloadUploadPart(request('PUT', { uploadId, index: '0' }, Buffer.from('neu')), context);
  await upload(storage, 'Liste.pdf', Buffer.from('alt'));

  const complete = (replace: boolean): Promise<{ status?: number; jsonBody?: unknown }> =>
    DownloadUploadComplete(
      request('POST', { uploadId }, { fileName: 'Liste.pdf', replace }),
      context
    );
  const refused = await complete(false);
  assert.equal(refused.status, 409);
  assert.equal((refused.jsonBody as { code: string }).code, 'EXISTS');
  assert.equal((await complete(true)).status, 201);
  // The parts are used up now
  const repeated = await complete(true);
  assert.equal((repeated.jsonBody as { code: string }).code, 'INCOMPLETE');
});

dbTest('an upload with missing or wrong parts is not saved', async (t) => {
  const storage = await setup(t);
  const { context, blobs } = storage;
  const start = async (): Promise<string> =>
    (
      (
        await DownloadUploadStart(
          request('POST', {}, { fileName: 'Teile.pdf', size: UPLOAD_PART_BYTES * 2 }),
          context
        )
      ).jsonBody as { uploadId: string }
    ).uploadId;
  const complete = async (uploadId: string): Promise<string> =>
    (
      (
        await DownloadUploadComplete(
          request('POST', { uploadId }, { fileName: 'Teile.pdf' }),
          context
        )
      ).jsonBody as { code: string }
    ).code;

  // Nothing uploaded
  assert.equal(await complete(await start()), 'INCOMPLETE');
  // The first part is missing
  const gap = await start();
  await DownloadUploadPart(
    request('PUT', { uploadId: gap, index: '1' }, Buffer.from('x')),
    context
  );
  assert.equal(await complete(gap), 'INCOMPLETE');
  // A part in the middle is too small
  const short = await start();
  await DownloadUploadPart(
    request('PUT', { uploadId: short, index: '0' }, Buffer.from('x')),
    context
  );
  await DownloadUploadPart(
    request('PUT', { uploadId: short, index: '1' }, Buffer.from('y')),
    context
  );
  assert.equal(await complete(short), 'INCOMPLETE');
  assert.equal(blobs.size, 0);
  assert.deepEqual(await listDownloads(), []);

  // Parts and keys are checked before anything is stored
  const tooBig = await DownloadUploadPart(
    request('PUT', { uploadId: gap, index: '0' }, Buffer.alloc(UPLOAD_PART_BYTES + 1)),
    context
  );
  assert.equal(tooBig.status, 400);
  const badKey = await DownloadUploadPart(
    request('PUT', { uploadId: '../leitende', index: '0' }, Buffer.from('x')),
    context
  );
  assert.equal(badKey.status, 404);
  const badIndex = await DownloadUploadPart(
    request('PUT', { uploadId: gap, index: '999' }, Buffer.from('x')),
    context
  );
  assert.equal(badIndex.status, 404);
  const tooLarge = await DownloadUploadStart(
    request('POST', {}, { fileName: 'Riesig.zip', size: 300 * 1024 * 1024 }),
    context
  );
  assert.equal(tooLarge.status, 400);
  const badPreview = await DownloadUploadComplete(
    request('POST', { uploadId: gap }, { fileName: 'Teile.pdf', preview: 'bm9jaCBrZWluIGJpbGQ=' }),
    context
  );
  assert.equal(badPreview.status, 400);
});

dbTest('files are renamed and deleted with their previews', async (t) => {
  const storage = await setup(t);
  const { context, blobs } = storage;
  const a = await upload(storage, 'Alpha.pdf', Buffer.from('a'), { preview: await jpeg(50, 70) });
  await upload(storage, 'Beta.pdf', Buffer.from('b'));
  const id = (a.jsonBody as { id: string }).id;

  const rename = (fileName: string): Promise<{ status?: number; jsonBody?: unknown }> =>
    DownloadItem(request('PATCH', { id }, { fileName }), context);
  assert.equal((await rename('beta.pdf')).status, 409);
  assert.equal((await rename('ALPHA.pdf')).status, 204);
  assert.equal((await rename('Alpha.docx')).status, 204);
  assert.equal((await rename('ohne-endung')).status, 400);
  const renamed = (await listDownloads()).find((file) => file.id === id);
  assert.equal(renamed?.mimeType, downloadDocx());
  const served = await GetDownloadFileEndpointInternal(request('GET', { id }), context);
  assert.match(
    (served.headers as Record<string, string>)['Content-Disposition'],
    /filename="Alpha.docx"/
  );

  assert.equal((await DownloadItem(request('DELETE', { id }), context)).status, 204);
  assert.equal((await DownloadItem(request('DELETE', { id }), context)).status, 404);
  assert.equal(
    (await DownloadItem(request('PATCH', { id }, { fileName: 'x.pdf' }), context)).status,
    404
  );
  assert.deepEqual(
    (await listDownloads()).map((file) => file.fileName),
    ['Beta.pdf']
  );
  assert.equal(blobs.size, 1);
});

function downloadDocx(): string {
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

dbTest('files no download refers to are removed once they are old enough', async (t) => {
  const storage = await setup(t);
  const { blobs, times } = storage;
  await upload(storage, 'Bleibt.pdf', Buffer.from('a'));
  blobs.set('downloads/verwaist/datei', Buffer.from('x'));
  times.set('downloads/verwaist/datei', new Date());
  assert.equal(await deleteOrphanedDownloadFiles(), 0);
  assert.equal(await deleteOrphanedDownloadFiles(Date.now() + 11 * 60_000), 1);
  assert.equal(blobs.size, 1);
});

interface FakeItem {
  id: string;
  name: string;
  thumbnail?: boolean;
  folder?: boolean;
}

/** A Graph client listing the given items, and `fetch` serving their files and thumbnails. */
async function sharePoint(t: TestContext, items: FakeItem[]): Promise<void> {
  const thumbnail = await jpeg(800, 1100);
  t.mock.method(token, 'getClient', () => {
    const self: Record<string, unknown> = {
      expand: () => self,
      get: async () => ({
        value: items.map((item) => ({
          id: item.id,
          name: item.name,
          size: 4,
          ...(item.folder ? { folder: {} } : { file: { mimeType: 'application/pdf' } }),
          '@microsoft.graph.downloadUrl': `https://files.example/${item.id}`,
          createdBy: { user: { displayName: 'Lea Leiterin' } },
          createdDateTime: '2024-03-01T10:00:00Z',
          lastModifiedBy: { user: { displayName: 'Kim Beispiel' } },
          lastModifiedDateTime: '2025-05-02T11:00:00Z',
          thumbnails: item.thumbnail
            ? [
                {
                  small: { url: `https://thumbs.example/${item.id}/small` },
                  large: { url: `https://thumbs.example/${item.id}/large` },
                },
              ]
            : [],
        })),
      }),
    };
    return { api: () => self } as unknown as Client;
  });
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.startsWith('https://thumbs.example/')) return new Response(new Uint8Array(thumbnail));
    if (url.startsWith('https://files.example/')) return new Response(`pdf:${url.slice(22)}`);
    return new Response('', { status: 404 });
  });
}

dbTest('the takeover copies the library with its IDs, also across several requests', async (t) => {
  const { context } = await setup(t);
  await sharePoint(t, [
    { id: '01AAA', name: 'Packliste.pdf', thumbnail: true },
    { id: '01BBB', name: 'Satzung.pdf' },
    { id: '01CCC', name: 'Ordner', folder: true },
  ]);

  // Out of time before the first file: nothing copied, not done
  assert.equal(await copyDownloads(0), false);
  assert.deepEqual(await listDownloads(), []);

  // A request that only copies one file leaves the rest for the next one
  let calls = 0;
  assert.equal(await copyDownloads(1, () => (calls++ < 2 ? 0 : 5)), false);
  assert.equal((await listDownloads()).length, 1);
  assert.equal(await copyDownloads(), true);
  assert.equal(await copyDownloads(), true);

  const files = await listDownloads();
  assert.deepEqual(
    files.map((file) => [
      file.id,
      file.fileName,
      file.hasPreview,
      file.createdBy,
      file.lastModifiedBy,
    ]),
    [
      ['01AAA', 'Packliste.pdf', true, 'Lea Leiterin', 'Kim Beispiel'],
      ['01BBB', 'Satzung.pdf', false, 'Lea Leiterin', 'Kim Beispiel'],
    ]
  );
  assert.equal(files[0].lastModifiedAt, '2025-05-02T11:00:00.000Z');
  const served = await GetDownloadFileEndpointInternal(request('GET', { id: '01AAA' }), context);
  assert.equal((await bodyBytes(served.body)).toString(), 'pdf:01AAA');
  const preview = await GetDownloadFileImageEndpointInternal(
    request('GET', { id: '01AAA', size: 'large' }),
    context
  );
  assert.equal(preview.status, 200);

  const record = await getDb()
    .selectFrom('content.sharepoint_import')
    .select('summary')
    .where('list', '=', 'downloads')
    .executeTakeFirstOrThrow();
  assert.deepEqual(JSON.parse(record.summary), { items: 2, previews: 1 });
});

dbTest('a file copied by two requests at once is saved once', async (t) => {
  const { blobs } = await setup(t);
  await sharePoint(t, [{ id: '01AAA', name: 'Packliste.pdf', thumbnail: true }]);
  const results = await Promise.all([copyDownloads(), copyDownloads()]);
  assert.deepEqual(results, [true, true]);
  assert.equal((await listDownloads()).length, 1);
  // The loser deleted its copy: one file with its two previews
  assert.equal(blobs.size, 3);
});

dbTest('previews get invented downloads once', async (t) => {
  await setup(t);
  await seedPreviewDownloads();
  await seedPreviewDownloads();
  const files = await listDownloads();
  assert.equal(files.length, 3);
  assert.equal(files.filter((file) => file.hasPreview).length, 2);
});
