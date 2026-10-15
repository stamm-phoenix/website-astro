import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { getBelege } from '../lib/beleg-list';
import { overrideConfig } from './fixtures/config';
import * as mail from '../lib/mail';
import {
  BelegeCollection,
  BelegItem,
  BelegPhoto,
  BelegPruefung,
  BelegRolle,
  downloadFileName,
  todayInBerlin,
} from '../endpoints/intern-pflege-belege';
import { validateBeleg, ValidationError } from '../lib/pflege-validation';
import { BelegCheckError, parseStoredBelegCheck, toBelegCheck } from '../lib/beleg-check';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const INPUT = {
  shop: 'REWE',
  date: '2026-09-30',
  amountCent: 1234,
  paidBy: 'Alex Beispiel',
  payout: true,
  aktion: 'Sommerlager',
  note: '',
};

/** Minimal JPEG header with a frame of the given size. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    ...new Array<number>(12).fill(0),
  ]);
}

/** A JPEG that can be decoded, for previews. */
async function realJpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#f4f1e8' } })
      .jpeg()
      .toBuffer()
  );
}

interface Storage {
  context: InvocationContext;
  blobs: Map<string, Buffer>;
  times: Map<string, Date>;
}

/** Blob Storage in memory and a quiet context. */
function setup(t: TestContext): Storage {
  const blobs = new Map<string, Buffer>();
  const times = new Map<string, Date>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
    times.set(name, new Date());
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: times.get(name) ?? new Date() }))
  );
  t.mock.method(console, 'warn', () => undefined);
  const context = new InvocationContext({ functionName: 'belege-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return { context, blobs, times };
}

interface StoredBelegRow {
  id: number;
  status?: 'Eingereicht' | 'Angenommen' | 'Abgelehnt';
  submittedBy?: string;
  submittedAt?: string;
  shop?: string;
  photo?: string;
}

/** Stores receipts as they are, with their photo files. */
async function store(blobs: Map<string, Buffer>, ...rows: StoredBelegRow[]): Promise<void> {
  for (const row of rows) {
    await getDb()
      .insertInto('organisation.beleg')
      .values({
        id: row.id,
        shop: row.shop ?? 'REWE',
        beleg_date: '2026-09-30',
        amount_cent: 1234,
        paid_by: 'Alex Beispiel',
        payout: true,
        aktion: 'Sommerlager',
        note: '',
        status: row.status ?? 'Eingereicht',
        review_note: '',
        submitted_by: row.submittedBy ?? 'leitung@example.test',
        submitted_at: row.submittedAt ?? '2026-09-30T10:00:00.000Z',
        photo: row.photo ?? null,
      })
      .execute();
    if (row.photo) {
      blobs.set(`belege/${row.id}/${row.photo}`, Buffer.from(await realJpeg(1200, 1600)));
      const original = row.photo.replace(/-scan\.jpg$/, '-original.jpg');
      if (original !== row.photo) {
        blobs.set(`belege/${row.id}/${original}`, Buffer.from(jpeg(10, 10)));
      }
    }
  }
}

async function version(id: number): Promise<string> {
  const beleg = (await getBelege()).find((candidate) => candidate.id === String(id));
  assert.ok(beleg, `receipt ${id}`);
  return beleg.etag;
}

function request(
  method: string,
  body?: unknown,
  options: { id?: string; etag?: string; principal?: unknown; query?: string } = {}
): HttpRequest {
  const binary = body instanceof Uint8Array;
  const headers: Record<string, string> = {
    'content-type': binary ? 'image/jpeg' : 'application/json',
  };
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? PRINCIPAL)
    ).toString('base64');
  }
  if (options.etag) headers['if-match'] = options.etag;
  return new HttpRequest({
    url: `http://localhost/api/intern/pflege/belege${options.query ?? ''}`,
    method,
    headers,
    params: options.id ? { id: options.id } : {},
    body:
      body === undefined || method === 'GET'
        ? undefined
        : binary
          ? { bytes: body }
          : { string: JSON.stringify(body) },
  });
}

test('receipt operations reject anonymous identities before reading anything', async (t) => {
  const { context } = setup(t);
  for (const principal of [null, { ...PRINCIPAL, identityProvider: 'github' }]) {
    assert.equal(
      (await BelegeCollection(request('GET', undefined, { principal }), context)).status,
      401
    );
    assert.equal(
      (await BelegItem(request('DELETE', undefined, { id: '1', principal }), context)).status,
      401
    );
    assert.equal(
      (await BelegPhoto(request('GET', undefined, { id: '1', principal }), context)).status,
      401
    );
  }
});

dbTest('submitting a receipt stores details, uploader and photo as unchecked', async (t) => {
  const { context, blobs } = setup(t);
  const log = t.mock.method(context, 'log', () => undefined);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');

  const response = await BelegeCollection(
    request('POST', { ...INPUT, status: 'Angenommen', reviewNote: 'ok', photo }),
    context
  );
  assert.equal(response.status, 201);
  const { id } = response.jsonBody as { id: string };
  const [stored] = await getBelege();
  assert.deepEqual(
    { ...stored, etag: undefined, submittedAt: undefined, photo: undefined },
    {
      id,
      etag: undefined,
      ...INPUT,
      status: 'Eingereicht',
      reviewNote: '',
      submittedBy: 'staff@example.test',
      submittedAt: undefined,
      hasImage: true,
      hasOriginal: false,
      aiCheck: null,
      photo: undefined,
    }
  );
  assert.match(stored?.photo ?? '', /^beleg-\d+\.jpg$/);
  assert.deepEqual([...blobs.keys()], [`belege/${id}/${stored?.photo}`]);
  assert.deepEqual(log.mock.calls[0].arguments, ['[pflege] staff@example.test POST belege']);
});

dbTest('receipts without a usable photo are rejected before anything is written', async (t) => {
  const { context, blobs } = setup(t);
  for (const photo of [
    undefined,
    '',
    'not base64!',
    Buffer.from('%PDF-1.4').toString('base64'),
    Buffer.from(jpeg(600, 400)).toString('base64'),
  ]) {
    const response = await BelegeCollection(request('POST', { ...INPUT, photo }), context);
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await getBelege(), []);
  assert.equal(blobs.size, 0);
});

dbTest('a failed photo upload stores no receipt', async (t) => {
  const { context, blobs } = setup(t);
  (blobStorage.putBlob as unknown as { mock: { restore(): void } }).mock.restore();
  t.mock.method(blobStorage, 'putBlob', async () => {
    throw new Error('Blob Storage unavailable');
  });
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const response = await BelegeCollection(request('POST', { ...INPUT, photo }), context);
  assert.equal(response.status, 500);
  assert.deepEqual(await getBelege(), []);
  assert.equal(blobs.size, 0);
});

dbTest('the receipt list sorts the newest first and keeps photo names on the server', async (t) => {
  const { context, blobs } = setup(t);
  await store(
    blobs,
    { id: 1, shop: 'Bauhaus', submittedAt: '2026-09-01T10:00:00.000Z' },
    { id: 2, status: 'Abgelehnt', submittedAt: '2026-09-30T10:00:00.000Z', photo: 'beleg-1.jpg' }
  );
  const response = await BelegeCollection(request('GET'), context);
  assert.equal(response.status, 200);
  const items = response.jsonBody as Record<string, unknown>[];
  assert.deepEqual(
    items.map(({ id, status, hasImage }) => ({ id, status, hasImage })),
    [
      { id: '2', status: 'Abgelehnt', hasImage: true },
      { id: '1', status: 'Eingereicht', hasImage: false },
    ]
  );
  assert.equal(items[0]?.submittedAt, '2026-09-30T10:00:00.000Z');
  assert.equal('photo' in (items[0] ?? {}), false);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
});

dbTest('reviewing and deleting receipts require the loaded version', async (t) => {
  const { context, blobs } = setup(t);
  await store(blobs, { id: 7, photo: 'beleg-1-scan.jpg' });
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const review = { ...INPUT, status: 'Angenommen', reviewNote: '' };

  assert.equal((await BelegItem(request('PATCH', review, { id: '7' }), context)).status, 400);
  assert.equal((await BelegItem(request('DELETE', undefined, { id: '7' }), context)).status, 400);

  const loaded = await version(7);
  const patched = await BelegItem(
    request('PATCH', { ...review, etag: loaded }, { id: '7' }),
    context
  );
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.jsonBody, { mailed: false });
  assert.equal(send.mock.callCount(), 0);
  assert.equal((await getBelege())[0]?.status, 'Angenommen');

  const conflict = await BelegItem(
    request('PATCH', { ...review, etag: loaded }, { id: '7' }),
    context
  );
  assert.equal(conflict.status, 409);
  assert.equal(
    (await BelegItem(request('DELETE', undefined, { id: '7', etag: loaded }), context)).status,
    409
  );

  assert.equal(
    (await BelegItem(request('DELETE', undefined, { id: '7', etag: await version(7) }), context))
      .status,
    204
  );
  assert.deepEqual(await getBelege(), []);
  assert.equal(blobs.size, 0);
});

dbTest('rejecting a receipt mails the reason to the uploader once', async (t) => {
  const { context, blobs } = setup(t);
  t.mock.method(context, 'warn', () => undefined);
  await store(blobs, { id: 7 });
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const reject = async (): Promise<Record<string, unknown>> => ({
    ...INPUT,
    status: 'Abgelehnt',
    reviewNote: 'Foto <unscharf>',
    etag: await version(7),
  });
  const reset = async (): Promise<void> => {
    await getDb()
      .updateTable('organisation.beleg')
      .set({ status: 'Eingereicht' })
      .where('id', '=', 7)
      .execute();
  };

  // Without a sender mailbox the decision is saved but no mail is sent
  overrideConfig(t, CONFIG.mail, { belegeSender: undefined });
  let response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { mailed: false });
  assert.equal((await getBelege())[0]?.status, 'Abgelehnt');
  assert.equal(send.mock.callCount(), 0);

  await reset();
  CONFIG.mail.belegeSender = 'kasse@example.test';
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.deepEqual(response.jsonBody, { mailed: true });
  const [to, subject, html, sender] = send.mock.calls[0].arguments;
  assert.equal(to, 'leitung@example.test');
  assert.equal(subject, 'Beleg abgelehnt: REWE');
  assert.equal(sender, 'kasse@example.test');
  assert.match(String(html), /Foto &lt;unscharf&gt;/);
  assert.match(String(html), /30\.09\.2026 über 12,34/);
  assert.match(String(html), /\/leitendenbereich\/belege/);
  assert.match(String(html), /staff@example\.test/);

  // Saving an already rejected receipt again sends no second mail
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.deepEqual(response.jsonBody, { mailed: false });
  assert.equal(send.mock.callCount(), 1);

  // A failing mail never undoes the saved decision
  await reset();
  send.mock.mockImplementation(async () => {
    throw new Error('mailbox');
  });
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { mailed: false });
  assert.equal((await getBelege())[0]?.status, 'Abgelehnt');
});

dbTest('only the Kasse sees all receipts and decides; uploaders manage their own', async (t) => {
  const { context, blobs } = setup(t);
  const uploader = { ...PRINCIPAL, userDetails: 'Leitung@Example.test' };
  const kasse = { ...PRINCIPAL, userDetails: 'kasse@example.test' };
  overrideConfig(t, CONFIG.belege, { reviewers: ['Kasse@example.test', 'schatz@example.test'] });
  await store(
    blobs,
    { id: 7, status: 'Abgelehnt', submittedAt: '2026-09-01T10:00:00.000Z' },
    { id: 8, submittedBy: 'other@example.test' }
  );
  const ids = async (principal: unknown) =>
    (
      (await BelegeCollection(request('GET', undefined, { principal }), context)).jsonBody as {
        id: string;
      }[]
    ).map((b) => b.id);

  assert.deepEqual(await ids(uploader), ['7']);
  assert.deepEqual(await ids(kasse), ['8', '7']);
  const role = await BelegRolle(request('GET', undefined, { principal: uploader }), context);
  assert.deepEqual(role.jsonBody, { reviewer: false });

  const patch = async (body: Record<string, unknown>, principal: unknown) =>
    BelegItem(
      request('PATCH', { ...INPUT, etag: await version(7), ...body }, { id: '7', principal }),
      context
    );
  // Uploaders can resubmit a rejected receipt but keep the remark of the Kasse
  await getDb()
    .updateTable('organisation.beleg')
    .set({ review_note: 'Unscharf' })
    .where('id', '=', 7)
    .execute();
  assert.equal((await patch({ status: 'Angenommen' }, uploader)).status, 403);
  assert.equal((await patch({ status: 'Eingereicht', reviewNote: 'egal' }, uploader)).status, 200);
  const resubmitted = (await getBelege()).find((beleg) => beleg.id === '7');
  assert.deepEqual([resubmitted?.status, resubmitted?.reviewNote], ['Eingereicht', 'Unscharf']);
  // Others' receipts and accepted receipts are off limits for uploaders
  assert.equal(
    (
      await patch(
        { status: 'Abgelehnt', reviewNote: 'x' },
        { ...uploader, userDetails: 'x@example.test' }
      )
    ).status,
    403
  );
  await getDb()
    .updateTable('organisation.beleg')
    .set({ status: 'Angenommen' })
    .where('id', '=', 7)
    .execute();
  assert.equal((await patch({ status: 'Angenommen' }, uploader)).status, 403);
  assert.equal(
    (
      await BelegItem(
        request('DELETE', undefined, { id: '7', etag: await version(7), principal: uploader }),
        context
      )
    ).status,
    403
  );
  assert.equal(
    (
      await BelegPhoto(
        request('GET', undefined, {
          id: '7',
          principal: { ...uploader, userDetails: 'x@example.test' },
        }),
        context
      )
    ).status,
    404
  );
  // The Kasse decides
  assert.equal((await patch({ status: 'Abgelehnt', reviewNote: 'Unscharf' }, kasse)).status, 200);
  assert.equal(
    (
      await BelegItem(
        request('DELETE', undefined, { id: '7', etag: await version(7), principal: kasse }),
        context
      )
    ).status,
    204
  );
  assert.deepEqual(await ids(kasse), ['8']);
});

dbTest('the photo is served privately, as a preview and as a named download', async (t) => {
  const { context, blobs } = setup(t);
  await store(blobs, { id: 7, shop: 'REWE / Markt', photo: 'beleg-1.jpg' });

  const inline = await BelegPhoto(request('GET', undefined, { id: '7' }), context);
  assert.equal(inline.status, 200);
  assert.deepEqual(Buffer.from(inline.body as Uint8Array), blobs.get('belege/7/beleg-1.jpg'));
  const headers = inline.headers as Record<string, string>;
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Content-Type'], 'image/jpeg');
  assert.equal(headers['Content-Disposition'], undefined);

  const download = await BelegPhoto(
    request('GET', undefined, { id: '7', query: '?download=1' }),
    context
  );
  assert.match(
    (download.headers as Record<string, string>)['Content-Disposition'],
    /filename="2026-09-30 REWE Markt 12,34 EUR\.jpg"/
  );

  // The preview is made once and kept
  const thumb = await BelegPhoto(
    request('GET', undefined, { id: '7', query: '?thumb=1' }),
    context
  );
  assert.equal(thumb.status, 200);
  assert.equal((thumb.headers as Record<string, string>)['Cache-Control'], 'private, max-age=300');
  const size = await sharp(Buffer.from(thumb.body as Uint8Array)).metadata();
  assert.deepEqual([size.width, size.height], [360, 480]);
  assert.ok(blobs.has('belege/7/beleg-1-thumb.jpg'));
  assert.equal(
    (await BelegPhoto(request('GET', undefined, { id: '7', query: '?original=1' }), context))
      .status,
    404
  );
  // A photo that cannot be scaled is shown as it is
  blobs.set('belege/7/beleg-1.jpg', Buffer.from(jpeg(1200, 1600)));
  blobs.delete('belege/7/beleg-1-thumb.jpg');
  const fallback = await BelegPhoto(
    request('GET', undefined, { id: '7', query: '?thumb=1' }),
    context
  );
  assert.equal(fallback.status, 200);
  assert.deepEqual(Buffer.from(fallback.body as Uint8Array), Buffer.from(jpeg(1200, 1600)));
});

dbTest('replacing the photo checks the version and removes the old files', async (t) => {
  const { context, blobs } = setup(t);
  await store(blobs, { id: 7, photo: 'beleg-1-scan.jpg' });
  await BelegPhoto(request('GET', undefined, { id: '7', query: '?thumb=1' }), context);
  const photo = { photo: Buffer.from(jpeg(1200, 1600)).toString('base64') };
  const loaded = await version(7);

  await getDb()
    .updateTable('organisation.beleg')
    .set({ note: 'geändert' })
    .where('id', '=', 7)
    .execute();
  assert.equal(
    (await BelegPhoto(request('PUT', photo, { id: '7', etag: loaded }), context)).status,
    409
  );
  assert.deepEqual([...blobs.keys()].sort(), [
    'belege/7/beleg-1-original.jpg',
    'belege/7/beleg-1-scan.jpg',
    'belege/7/beleg-1-thumb.jpg',
  ]);

  const response = await BelegPhoto(
    request('PUT', photo, { id: '7', etag: await version(7) }),
    context
  );
  assert.equal(response.status, 200);
  const [stored] = await getBelege();
  assert.equal(stored?.hasOriginal, false);
  assert.notEqual(stored?.etag, loaded);
  assert.deepEqual([...blobs.keys()], [`belege/7/${stored?.photo}`]);
});

dbTest('any change of a receipt removes photo files left over earlier', async (t) => {
  const { context, blobs, times } = setup(t);
  await store(blobs, { id: 7, photo: 'beleg-1.jpg' });
  // Files no receipt refers to: an old one from a failed cleanup and one being saved right now
  const old = Buffer.from(jpeg(10, 10));
  blobs.set('belege/3/beleg-9.jpg', old);
  times.set('belege/3/beleg-9.jpg', new Date(Date.now() - 11 * 60_000));
  blobs.set('belege/7/beleg-2.jpg', old);
  times.set('belege/7/beleg-2.jpg', new Date());
  const review = { ...INPUT, status: 'Angenommen', reviewNote: '', etag: await version(7) };

  const saved = await BelegItem(request('PATCH', review, { id: '7' }), context);
  assert.equal(saved.status, 200);
  assert.deepEqual([...blobs.keys()].sort(), ['belege/7/beleg-1.jpg', 'belege/7/beleg-2.jpg']);
});

dbTest('a scan is stored together with its original, which can be downloaded', async (t) => {
  const { context, blobs } = setup(t);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const original = Buffer.from(jpeg(1500, 2000)).toString('base64');

  const invalid = await BelegeCollection(
    request('POST', { ...INPUT, photo, original: 'kein Foto' }),
    context
  );
  assert.equal(invalid.status, 400);
  assert.equal(blobs.size, 0);

  const created = await BelegeCollection(request('POST', { ...INPUT, photo, original }), context);
  assert.equal(created.status, 201);
  const { id } = created.jsonBody as { id: string };
  const [stored] = await getBelege();
  assert.match(stored?.photo ?? '', /^beleg-\d+-scan\.jpg$/);
  assert.equal(stored?.hasOriginal, true);
  const originalName = `belege/${id}/${(stored?.photo ?? '').replace('-scan', '-original')}`;
  assert.deepEqual(blobs.get(originalName), Buffer.from(original, 'base64'));

  const response = await BelegPhoto(
    request('GET', undefined, { id, query: '?original=1&download=1' }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(response.body as Uint8Array), Buffer.from(original, 'base64'));
  assert.match(
    (response.headers as Record<string, string>)['Content-Disposition'],
    /2026-09-30 REWE 12,34 EUR Original\.jpg/
  );
});

test('receipt validation rejects missing, future and implausible values', () => {
  const today = '2026-10-01';
  assert.deepEqual(validateBeleg({ ...INPUT, payout: false }, today), {
    ...INPUT,
    payout: false,
    status: 'Eingereicht',
    reviewNote: '',
  });
  for (const [body, field] of [
    [{ ...INPUT, shop: ' ' }, 'shop'],
    [{ ...INPUT, paidBy: '' }, 'paidBy'],
    [{ ...INPUT, aktion: '' }, 'aktion'],
    [{ ...INPUT, date: '2026-10-02' }, 'date'],
    [{ ...INPUT, date: '2026-02-30' }, 'date'],
    [{ ...INPUT, date: '30.09.2026' }, 'date'],
    [{ ...INPUT, amountCent: 0 }, 'amountCent'],
    [{ ...INPUT, amountCent: 12.5 }, 'amountCent'],
    [{ ...INPUT, amountCent: '1234' }, 'amountCent'],
    [{ ...INPUT, amountCent: 1_000_001 }, 'amountCent'],
    [{ ...INPUT, status: 'Bezahlt' }, 'status'],
    [{ ...INPUT, status: 'Geprüft' }, 'status'],
    [{ ...INPUT, status: 'Abgelehnt', reviewNote: ' ' }, 'reviewNote'],
  ] as const) {
    assert.throws(
      () => validateBeleg(body, today),
      (error: unknown) =>
        error instanceof ValidationError && typeof error.fields[field] === 'string',
      `${field}: ${JSON.stringify(body)}`
    );
  }
});

test('receipt helpers use German local dates and safe file names', () => {
  assert.equal(todayInBerlin(new Date('2026-09-30T22:30:00Z')), '2026-10-01');
  assert.equal(
    downloadFileName({
      id: '1',
      etag: '',
      shop: 'A:B*C',
      date: '',
      amountCent: 5,
      paidBy: '',
      payout: false,
      aktion: '',
      note: '',
      status: 'Eingereicht',
      reviewNote: '',
      submittedBy: '',
      submittedAt: '',
      hasImage: true,
      hasOriginal: false,
      aiCheck: null,
    }),
    'Beleg A B C 0,05 EUR.jpg'
  );
});

const MODEL_ANSWER = {
  isReceipt: true,
  complete: false,
  readable: true,
  issues: ['  Der untere Rand   ist abgeschnitten. ', 7],
  restrictedItems: [' Augustiner  Hell 0,5l ', null],
  shop: 'REWE',
  date: '2026-09-30',
  amount: 12.34,
};

const MODEL_ENDPOINT = 'https://example.openai.azure.com';

function withModel(t: TestContext, maxChecksPerDay = 1000): void {
  overrideConfig(t, CONFIG.belege.check, {
    endpoint: MODEL_ENDPOINT,
    deployment: 'gpt-4.1-mini',
    maxChecksPerDay,
  });
  const previousKey = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
  });
}

function mockModel(t: TestContext, answer: unknown = MODEL_ANSWER, status = 200) {
  return t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        { status }
      )
  );
}

test('the model answer is normalized and never trusted blindly', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  assert.deepEqual(toBelegCheck(MODEL_ANSWER, now), {
    ok: false,
    isReceipt: true,
    complete: false,
    readable: true,
    issues: ['Der untere Rand ist abgeschnitten.'],
    restrictedItems: ['Augustiner Hell 0,5l'],
    shop: 'REWE',
    date: '2026-09-30',
    amountCent: 1234,
    checkedAt: '2026-10-01T10:00:00.000Z',
  });
  const notAReceipt = toBelegCheck(
    {
      isReceipt: false,
      complete: true,
      readable: true,
      issues: [],
      restrictedItems: ['Bier'],
      date: '30.9.',
      amount: -1,
    },
    now
  );
  assert.equal(notAReceipt.ok, false);
  assert.deepEqual(notAReceipt.restrictedItems, []);
  // Restricted items are a hint for the Kasse and do not make a good photo unfit
  assert.equal(toBelegCheck({ ...MODEL_ANSWER, complete: true }, now).ok, true);
  assert.equal(notAReceipt.complete, false);
  assert.equal(notAReceipt.date, null);
  assert.equal(notAReceipt.amountCent, null);
  assert.throws(() => toBelegCheck('nonsense'), BelegCheckError);
});

test('the photo check sends the image to the configured deployment', async (t) => {
  const { context } = setup(t);
  withModel(t);
  const fetch = mockModel(t);
  const response = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(response.status, 200);
  const body = response.jsonBody as { available: boolean; check: { ok: boolean } };
  assert.equal(body.available, true);
  assert.equal(body.check.ok, false);
  const [url, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, 'https://example.openai.azure.com/openai/v1/chat/completions');
  assert.equal((init.headers as Record<string, string>)['api-key'], 'test-key');
  const sent = JSON.parse(String(init.body)) as {
    model: string;
    messages: { content: unknown }[];
  };
  assert.equal(sent.model, 'gpt-4.1-mini');
  assert.match(JSON.stringify(sent.messages[1].content), /data:image\/jpeg;base64,/);
});

dbTest('without a model the check is skipped and failures never block submitting', async (t) => {
  const { context } = setup(t);
  withModel(t);
  CONFIG.belege.check.endpoint = '';
  const skipped = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.deepEqual(skipped.jsonBody, { available: false, check: null });

  CONFIG.belege.check.endpoint = MODEL_ENDPOINT;
  mockModel(t, {}, 500);
  const failed = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(failed.status, 502);

  t.mock.method(context, 'warn', () => undefined);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const created = await BelegeCollection(request('POST', { ...INPUT, photo }), context);
  assert.equal(created.status, 201);
  assert.equal((await getBelege())[0]?.aiCheck, null);
});

dbTest('submitting stores the check with the receipt', async (t) => {
  const { context } = setup(t);
  withModel(t);
  mockModel(t);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  assert.equal((await BelegeCollection(request('POST', { ...INPUT, photo }), context)).status, 201);
  const stored = (await getBelege())[0]?.aiCheck;
  assert.equal(stored?.ok, false);
  assert.deepEqual(stored?.issues, ['Der untere Rand ist abgeschnitten.']);
  assert.deepEqual(stored?.restrictedItems, ['Augustiner Hell 0,5l']);
  // Checks stored before restricted items existed still parse
  assert.deepEqual(parseStoredBelegCheck('{"ok":true,"issues":[]}')?.restrictedItems, []);
});

test('the daily limit stops calling the model', async (t) => {
  const { context } = setup(t);
  withModel(t, 0);
  const fetch = mockModel(t);
  const response = await BelegPruefung(request('POST', jpeg(1200, 1600)), context);
  assert.equal(response.status, 429);
  assert.equal(fetch.mock.callCount(), 0);
});
