import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import * as env from '../lib/environment';
import { getBelege } from '../lib/beleg-list';
import * as taskDirectory from '../lib/task-directory';
import { campflowDescription, campflowDisburser, campflowFileName } from '../lib/beleg-campflow';
import type { StoredBeleg } from '../lib/beleg-list';
import { BelegCampflow, BelegeCampflow, BelegItem } from '../endpoints/intern-pflege-belege';
import { dbTest } from './fixtures/database';
import test from 'node:test';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'kasse@example.test',
  userRoles: ['authenticated', 'team_leitende', 'team_kasse'],
};
const STAFF_ROLES = ['authenticated', 'team_leitende'];
const PHOTO = Buffer.from('jpeg of the scan');
const UNITS = [
  {
    id: 'cun_Lager',
    name: 'Stammeslager 2026',
    archived: false,
    categories: [
      { id: 'cat_Essen', name: 'Verpflegung', sphere: 'purpose' },
      { id: 'cat_Fahrt', name: 'Fahrtkosten', sphere: 'purpose' },
    ],
  },
  {
    id: 'cun_Alt',
    name: 'Lager 2019',
    archived: true,
    categories: [{ id: 'cat_Alt', name: 'Verpflegung', sphere: 'purpose' }],
  },
];
const CHOICE = { costUnitId: 'cun_Lager', categoryId: 'cat_Essen' };

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/**
 * Blob Storage in memory and a stand-in for the Playwright API: `answer` decides each upload's
 * response. CampFlow itself is never called.
 */
function setup(
  t: TestContext,
  answer: (body: Record<string, unknown>) => Response | Promise<Response>
): { context: InvocationContext; blobs: Map<string, Buffer>; calls: Call[] } {
  const blobs = new Map<string, Buffer>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: new Date(0) }))
  );
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  t.mock.method(console, 'warn', () => undefined);
  const calls: Call[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, new URL(CONFIG.playwrightApi.url).origin);
    assert.equal((init.headers as Record<string, string>)['x-api-key'], 'test-key');
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname, ...(body ? { body } : {}) });
    if (method === 'GET' && url.pathname === '/campflow/kostenstellen') {
      return Response.json({ data: UNITS });
    }
    if (method === 'POST' && url.pathname === '/campflow/belege' && body) return answer(body);
    if (method === 'GET' && url.pathname === '/campflow/belege') {
      return answer({ refresh: url.searchParams.get('refresh') === 'true' });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  });
  const context = new InvocationContext({ functionName: 'belege-campflow-test' });
  t.mock.method(context, 'log', () => undefined);
  return { context, blobs, calls };
}

const uploaded = (created = true) =>
  Response.json(
    {
      created,
      number: '2026-112',
      receiptId: 'rcp_Neu',
      expenseId: 'exp_Neu',
      costUnit: { id: 'cun_Lager', name: 'Stammeslager 2026' },
      category: { id: 'cat_Essen', name: 'Verpflegung' },
    },
    { status: created ? 201 : 200 }
  );

async function store(
  blobs: Map<string, Buffer>,
  id: number,
  values: { status?: 'Eingereicht' | 'Angenommen'; payout?: boolean; note?: string } = {}
): Promise<string> {
  await getDb()
    .insertInto('organisation.beleg')
    .values({
      id,
      shop: 'REWE',
      beleg_date: '2026-09-30',
      amount_cent: 1234,
      paid_by: 'Alex Beispiel',
      payout: values.payout ?? true,
      aktion: 'Stammeslager 2026',
      note: values.note ?? 'Grillgut',
      status: values.status ?? 'Angenommen',
      review_note: '',
      submitted_by: 'leitung@example.test',
      submitted_at: '2026-09-30T10:00:00.000Z',
      photo: 'beleg-123-scan.jpg',
    })
    .execute();
  blobs.set(`belege/${id}/beleg-123-scan.jpg`, PHOTO);
  blobs.set(`belege/${id}/beleg-123-original.jpg`, Buffer.from('original'));
  return version(id);
}

async function version(id: number): Promise<string> {
  const beleg = (await getBelege()).find((candidate) => candidate.id === String(id));
  assert.ok(beleg, `receipt ${id}`);
  return beleg.etag;
}

function transfer(
  context: InvocationContext,
  id: number,
  body: Record<string, unknown>,
  principal = PRINCIPAL
): ReturnType<typeof BelegCampflow> {
  return BelegCampflow(
    new HttpRequest({
      url: `http://localhost/api/intern/pflege/belege/${id}/campflow`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
      params: { id: String(id) },
      body: { string: JSON.stringify(body) },
    }),
    context
  );
}

const transferRow = (id: number) =>
  getDb()
    .selectFrom('organisation.beleg_campflow')
    .selectAll()
    .where('beleg_id', '=', id)
    .executeTakeFirst();

dbTest('an accepted receipt is uploaded with its details and deleted afterwards', async (t) => {
  const { context, blobs, calls } = setup(t, () => uploaded());
  const etag = await store(blobs, 7);

  const response = await transfer(context, 7, { etag, ...CHOICE });

  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  assert.equal((response.jsonBody as { deleted: boolean }).deleted, true);
  assert.equal((response.jsonBody as { created: boolean }).created, true);
  assert.equal((response.jsonBody as { campflow: { number: string } }).campflow.number, '2026-112');
  const upload = calls.find((call) => call.method === 'POST');
  assert.deepEqual(upload?.body, {
    filename: '2026-09-30 REWE 12,34 EUR (Website-Beleg 7).jpg',
    content: PHOTO.toString('base64'),
    description: 'REWE – Grillgut',
    date: '2026-09-30',
    amountCent: 1234,
    disburser: 'Alex Beispiel',
    costUnit: 'cun_Lager',
    category: 'cat_Essen',
  });
  assert.deepEqual(await getBelege(), []);
  assert.deepEqual([...blobs.keys()], []);
  const row = await transferRow(7);
  assert.equal(row?.state, 'Hochgeladen');
  assert.equal(row?.campflow_number, '2026-112');
  assert.equal(row?.campflow_receipt_id, 'rcp_Neu');
  assert.equal(row?.costunit_name, 'Stammeslager 2026');
  assert.equal(row?.category_name, 'Verpflegung');
  assert.equal(row?.amount_cent, 1234);
  assert.equal(row?.started_by, 'kasse@example.test');
  assert.ok(row?.uploaded_at);
  assert.ok(row?.beleg_deleted_at);
});

dbTest(
  'only the Kasse transfers accepted, unchanged receipts to existing Kategorien',
  async (t) => {
    const { context, blobs, calls } = setup(t, () => uploaded());
    const etag = await store(blobs, 7);
    const submitted = await store(blobs, 8, { status: 'Eingereicht' });

    const other = { ...PRINCIPAL, userDetails: 'leitung@example.test', userRoles: STAFF_ROLES };
    assert.equal((await transfer(context, 7, { etag, ...CHOICE }, other)).status, 403);
    assert.equal((await transfer(context, 8, { etag: submitted, ...CHOICE })).status, 422);
    assert.equal((await transfer(context, 7, { etag: submitted, ...CHOICE })).status, 409);
    assert.equal((await transfer(context, 7, { ...CHOICE })).status, 400);
    assert.equal((await transfer(context, 7, { etag, costUnitId: 'cun_Lager' })).status, 400);
    assert.equal(
      (await transfer(context, 7, { etag, costUnitId: 'cun_Lager', categoryId: 'cat_Alt' })).status,
      400
    );
    const archived = await transfer(context, 7, {
      etag,
      costUnitId: 'cun_Alt',
      categoryId: 'cat_Alt',
    });
    assert.equal(archived.status, 422);
    assert.equal((await transfer(context, 99, { etag, ...CHOICE })).status, 404);

    assert.deepEqual(
      calls.filter((call) => call.method === 'POST'),
      []
    );
    assert.equal(await transferRow(7), undefined);
    assert.equal((await getBelege()).length, 2);
  }
);

dbTest(
  'after an unclear attempt the repeat keeps file and Kategorie and finds the receipt',
  async (t) => {
    let answers: Array<() => Response> = [
      () => Response.json({ error: 'Job exceeded 60000 ms' }, { status: 504 }),
      () => uploaded(false),
    ];
    const { context, blobs, calls } = setup(t, () => answers.shift()!());
    const etag = await store(blobs, 7);

    const unclear = await transfer(context, 7, { etag, ...CHOICE });
    assert.equal(unclear.status, 502);
    assert.equal((unclear.jsonBody as { code: string }).code, 'CAMPFLOW_UNCLEAR');
    const [beleg] = await getBelege();
    assert.equal(beleg?.campflow?.state, 'Gestartet');
    assert.equal(beleg?.campflow?.error, 'Job exceeded 60000 ms');
    assert.equal(beleg?.etag, etag, 'the receipt itself is unchanged');

    // Another Kategorie is ignored: only the first one finds what the first attempt created
    const repeat = await transfer(context, 7, {
      etag,
      costUnitId: 'cun_Lager',
      categoryId: 'cat_Fahrt',
    });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.jsonBody));
    assert.equal((repeat.jsonBody as { created: boolean }).created, false);
    const uploads = calls.filter((call) => call.method === 'POST');
    assert.equal(uploads.length, 2);
    assert.deepEqual(uploads[1]?.body, uploads[0]?.body);
    assert.deepEqual(await getBelege(), []);
    assert.equal((await transferRow(7))?.state, 'Hochgeladen');
    answers = [];
  }
);

dbTest('after a refused attempt another Kategorie may be chosen', async (t) => {
  const answers: Array<() => Response> = [
    () => Response.json({ error: 'Kategorie „X“ gibt es in „Y“ nicht' }, { status: 404 }),
    () => uploaded(),
  ];
  const { context, blobs, calls } = setup(t, () => answers.shift()!());
  const etag = await store(blobs, 7);

  const refused = await transfer(context, 7, { etag, ...CHOICE });
  assert.equal(refused.status, 502);
  assert.equal((refused.jsonBody as { code: string }).code, 'CAMPFLOW_REJECTED');
  assert.match((refused.jsonBody as { message: string }).message, /Kategorie „X“/);
  assert.equal((await transferRow(7))?.state, 'Fehlgeschlagen');

  const other = await transfer(context, 7, {
    etag,
    costUnitId: 'cun_Lager',
    categoryId: 'cat_Fahrt',
  });
  assert.equal(other.status, 200, JSON.stringify(other.jsonBody));
  const uploads = calls.filter((call) => call.method === 'POST');
  assert.equal(uploads[1]?.body?.category, 'cat_Fahrt');
  assert.equal((await transferRow(7))?.category_name, 'Fahrtkosten');
});

dbTest('a receipt changed during the upload stays until the Kasse deletes it', async (t) => {
  const { context, blobs, calls } = setup(t, async () => {
    await getDb()
      .updateTable('organisation.beleg')
      .set({ amount_cent: 2000 })
      .where('id', '=', 7)
      .execute();
    return uploaded();
  });
  const etag = await store(blobs, 7);

  const response = await transfer(context, 7, { etag, ...CHOICE });
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { deleted: boolean }).deleted, false);
  const [beleg] = await getBelege();
  assert.equal(beleg?.campflow?.state, 'Hochgeladen');
  assert.equal(beleg?.campflow?.number, '2026-112');

  // CampFlow holds the old amount, so the corrected receipt is never deleted automatically
  const again = await transfer(context, 7, { etag: beleg!.etag, ...CHOICE });
  assert.equal(again.status, 200);
  assert.equal((again.jsonBody as { deleted: boolean }).deleted, false);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal((await getBelege()).length, 1);

  // Deleted by hand it stays in the history, with what went to CampFlow
  const removed = await BelegItem(
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/belege/7',
      method: 'DELETE',
      headers: {
        'if-match': beleg!.etag,
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { id: '7' },
    }),
    context
  );
  assert.equal(removed.status, 204);
  assert.deepEqual(await deletedTransfers(), [{ id: 7, number: '2026-112' }]);
});

dbTest(
  'a correction after an unclear attempt is not deleted with the earlier booking',
  async (t) => {
    const answers: Array<() => Response> = [
      () => Response.json({ error: 'Job exceeded 60000 ms' }, { status: 504 }),
      // The first attempt had booked the receipt after all
      () => uploaded(false),
    ];
    const { context, blobs } = setup(t, () => answers.shift()!());
    const etag = await store(blobs, 7);
    assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 502);

    await getDb()
      .updateTable('organisation.beleg')
      .set({ amount_cent: 2000 })
      .where('id', '=', 7)
      .execute();
    const corrected = await version(7);
    const repeat = await transfer(context, 7, { etag: corrected, ...CHOICE });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.jsonBody));
    assert.equal((repeat.jsonBody as { deleted: boolean }).deleted, false);
    const [beleg] = await getBelege();
    assert.equal(beleg?.amountCent, 2000);
    assert.ok(blobs.has('belege/7/beleg-123-scan.jpg'), 'the corrected photo stays');
    // The history keeps what the first attempt sent, which is what CampFlow holds
    assert.equal((await transferRow(7))?.amount_cent, 1234);
  }
);

dbTest(
  'a new booking after an unclear attempt does not delete a receipt changed since',
  async (t) => {
    const answers: Array<() => Response> = [
      // The upload got through, the booking did not answer
      () => Response.json({ error: 'Job exceeded 60000 ms' }, { status: 504 }),
      // The repeat books the file the first attempt uploaded, with the old photo
      () => uploaded(true),
    ];
    const { context, blobs } = setup(t, () => answers.shift()!());
    const etag = await store(blobs, 7);
    assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 502);

    // A new photo makes a new version, like the photo endpoint does
    blobs.set('belege/7/beleg-123-scan.jpg', Buffer.from('neues Foto'));
    await getDb()
      .updateTable('organisation.beleg')
      .set({ note: 'neues Foto' })
      .where('id', '=', 7)
      .execute();
    const corrected = await version(7);
    const repeat = await transfer(context, 7, { etag: corrected, ...CHOICE });
    assert.equal(repeat.status, 200, JSON.stringify(repeat.jsonBody));
    assert.deepEqual(
      [
        (repeat.jsonBody as { created: boolean }).created,
        (repeat.jsonBody as { deleted: boolean }).deleted,
      ],
      [true, false]
    );
    assert.equal((await getBelege()).length, 1);
    assert.equal(blobs.get('belege/7/beleg-123-scan.jpg')?.toString(), 'neues Foto');
    // The history keeps what the unclear attempt sent
    assert.equal((await transferRow(7))?.state, 'Hochgeladen');
    assert.equal((await transferRow(7))?.note, 'Grillgut');
  }
);

dbTest('a refused repeat keeps an unclear attempt unclear and its Kategorie', async (t) => {
  const answers: Array<() => Response> = [
    () => Response.json({ error: 'Job exceeded 60000 ms' }, { status: 504 }),
    () => Response.json({ error: 'Kein CampFlow-Login' }, { status: 503 }),
    () => Response.json({ error: 'Bitte in 90 Sekunden erneut versuchen' }, { status: 429 }),
    () => uploaded(false),
  ];
  const { context, blobs, calls } = setup(t, () => answers.shift()!());
  const etag = await store(blobs, 7);
  assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 502);
  assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 502);
  assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 502);
  assert.equal((await transferRow(7))?.state, 'Gestartet');

  const other = await transfer(context, 7, {
    etag,
    costUnitId: 'cun_Lager',
    categoryId: 'cat_Fahrt',
  });
  assert.equal(other.status, 200);
  const uploads = calls.filter((call) => call.method === 'POST');
  assert.deepEqual(
    uploads.map((call) => call.body?.category),
    ['cat_Essen', 'cat_Essen', 'cat_Essen', 'cat_Essen']
  );
});

function deferred(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

async function untilUploads(calls: Call[], count: number): Promise<void> {
  while (calls.filter((call) => call.method === 'POST').length < count) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

dbTest('a second attempt is refused while one is running', async (t) => {
  const first = deferred();
  const { context, blobs, calls } = setup(t, () => first.promise);
  const etag = await store(blobs, 7);

  const running = transfer(context, 7, { etag, ...CHOICE });
  await untilUploads(calls, 1);
  const second = await transfer(context, 7, {
    etag,
    costUnitId: 'cun_Lager',
    categoryId: 'cat_Fahrt',
  });
  assert.equal(second.status, 423);
  assert.equal((second.jsonBody as { code: string }).code, 'TRANSFER_RUNNING');

  first.resolve(uploaded());
  assert.equal((await running).status, 200);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  const row = await transferRow(7);
  assert.equal(row?.category_id, 'cat_Essen');
  assert.equal(row?.amount_cent, 1234);
});

dbTest('a receipt deleted during its upload still lands in the history', async (t) => {
  const answer = deferred();
  const { context, blobs, calls } = setup(t, () => answer.promise);
  const etag = await store(blobs, 7);

  const running = transfer(context, 7, { etag, ...CHOICE });
  await untilUploads(calls, 1);
  const removed = await BelegItem(
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/belege/7',
      method: 'DELETE',
      headers: {
        'if-match': etag,
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { id: '7' },
    }),
    context
  );
  assert.equal(removed.status, 204);

  answer.resolve(uploaded());
  const response = await running;
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  assert.equal((response.jsonBody as { deleted: boolean }).deleted, true);
  assert.deepEqual(await deletedTransfers(), [{ id: 7, number: '2026-112' }]);
});

dbTest('a failing photo read ends the attempt, so another Kategorie may be chosen', async (t) => {
  const { context, blobs, calls } = setup(t, () => uploaded());
  const etag = await store(blobs, 7);
  let fail = true;
  const read = blobStorage.getBlob;
  t.mock.method(blobStorage, 'getBlob', async (name: string) => {
    if (fail) throw Object.assign(new Error('Storage unavailable'), { statusCode: 503 });
    return read(name);
  });

  const failed = await transfer(context, 7, { etag, ...CHOICE });
  assert.equal(failed.status, 502);
  assert.equal((failed.jsonBody as { code: string }).code, 'PHOTO_UNAVAILABLE');
  const row = await transferRow(7);
  assert.equal(row?.state, 'Fehlgeschlagen');
  assert.notEqual(row?.error, '');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0);

  fail = false;
  const other = await transfer(context, 7, {
    etag,
    costUnitId: 'cun_Lager',
    categoryId: 'cat_Fahrt',
  });
  assert.equal(other.status, 200, JSON.stringify(other.jsonBody));
  assert.equal(calls.find((call) => call.method === 'POST')?.body?.category, 'cat_Fahrt');
});

dbTest('saving a receipt answers with the version it wrote', async (t) => {
  const { context, blobs } = setup(t, () => uploaded());
  const etag = await store(blobs, 7);
  const response = await BelegItem(
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/belege/7',
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      },
      params: { id: '7' },
      body: {
        string: JSON.stringify({
          shop: 'REWE',
          date: '2026-09-30',
          amountCent: 2000,
          paidBy: 'Alex Beispiel',
          payout: true,
          aktion: 'Stammeslager 2026',
          note: '',
          status: 'Angenommen',
          reviewNote: '',
          etag,
        }),
      },
    }),
    context
  );
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const saved = (response.jsonBody as { etag: string }).etag;
  assert.notEqual(saved, etag);
  assert.equal(saved, await version(7));
});

type Json = Record<string, unknown>;

/** Uploaded receipts whose receipt here is gone, as the transfer table remembers them. */
async function deletedTransfers(): Promise<{ id: number; number: string | null }[]> {
  const rows = await getDb()
    .selectFrom('organisation.beleg_campflow')
    .select(['beleg_id', 'campflow_number'])
    .where('state', '=', 'Hochgeladen')
    .where('beleg_deleted_at', 'is not', null)
    .orderBy('beleg_id')
    .execute();
  return rows.map((row) => ({ id: row.beleg_id, number: row.campflow_number }));
}

function campflowList(
  context: InvocationContext,
  principal = PRINCIPAL,
  query = ''
): ReturnType<typeof BelegeCampflow> {
  return BelegeCampflow(
    new HttpRequest({
      url: `http://localhost/api/intern/pflege/belege/campflow${query}`,
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
    }),
    context
  );
}

/** Shaped like the Playwright API's GET /campflow/belege. */
const CAMPFLOW_LIST = {
  loadedAt: '2026-10-21T20:00:00.000Z',
  costUnits: [
    {
      id: 'cun_Lager',
      name: 'Stammeslager 2026',
      archived: false,
      categories: [{ id: 'cat_Essen', name: 'Verpflegung' }],
    },
  ],
  receipts: [
    {
      id: 'rcp_Offen',
      receiptId: 'rcp_Offen',
      number: null,
      status: 'unbooked',
      description: '',
      date: null,
      amount: 0,
      currency: 'EUR',
      amountEur: 0,
      openAmountEur: 0,
      paidBy: null,
      costUnits: [],
      categories: [],
      pages: 1,
      originalFilename: 'Kassenzettel.pdf',
      uploadedAt: '2026-10-20 08:00:00',
    },
    {
      id: 'exp_Neu',
      receiptId: 'rcp_Neu',
      number: '2026-112',
      status: 'open',
      description: 'REWE – Grillgut',
      date: '2026-09-30',
      amount: -12.34,
      currency: 'EUR',
      amountEur: -12.34,
      openAmountEur: -12.34,
      paidBy: 'Alex Beispiel',
      costUnits: [{ id: 'cun_Lager', name: 'Stammeslager 2026' }],
      categories: [
        { id: 'cat_Essen', name: 'Verpflegung', costUnitId: 'cun_Lager', amountEur: -12.34 },
      ],
      pages: 1,
      originalFilename: '2026-09-30 REWE 12,34 EUR (Website-Beleg 7).jpg',
      uploadedAt: '2026-10-21 19:00:00',
    },
    {
      id: 'exp_Alt',
      receiptId: 'rcp_Alt',
      number: '2026-5',
      status: 'settled',
      description: 'Zeltplatz',
      date: '2026-01-10',
      amount: -250,
      currency: 'EUR',
      amountEur: -250,
      openAmountEur: 0,
      paidBy: null,
      costUnits: [{ id: 'cun_Lager', name: 'Stammeslager 2026' }],
      categories: [
        { id: 'cat_Essen', name: 'Verpflegung', costUnitId: 'cun_Lager', amountEur: -250 },
      ],
      pages: 2,
      originalFilename: 'Rechnung Zeltplatz Max Mustermann.pdf',
      uploadedAt: null,
    },
  ],
};

dbTest('every leader sees all receipts in CampFlow, own transfers marked', async (t) => {
  const refreshes: unknown[] = [];
  const { context, blobs } = setup(t, (body) => {
    if ('refresh' in body) {
      refreshes.push(body.refresh);
      return Response.json(CAMPFLOW_LIST);
    }
    return uploaded();
  });
  const etag = await store(blobs, 7);
  assert.equal((await transfer(context, 7, { etag, ...CHOICE })).status, 200);

  // The browser does not know the names; the server marks Auslagen by the directory
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: 'leitung@example.test', name: 'Alex  Beispiel', givenName: 'Alex' },
  ]);
  const uploader = { ...PRINCIPAL, userDetails: 'Leitung@Example.test', userRoles: STAFF_ROLES };
  const mine = await campflowList(context, uploader, '?refresh=true');
  assert.equal(mine.status, 200, JSON.stringify(mine.jsonBody));
  const body = mine.jsonBody as { loadedAt: string; costUnits: unknown[]; belege: Json[] };
  assert.equal(body.loadedAt, CAMPFLOW_LIST.loadedAt);
  assert.deepEqual(body.costUnits, CAMPFLOW_LIST.costUnits);
  assert.deepEqual(body.belege[0], {
    id: 'rcp_Offen',
    number: null,
    status: 'unbooked',
    description: '',
    date: null,
    amountCent: 0,
    openCent: 0,
    paidBy: null,
    costUnits: [],
    categories: [],
    pages: 1,
    fileName: 'Kassenzettel.pdf',
    uploadedAt: '2026-10-20 08:00:00',
    viaWebsite: false,
    submittedByMe: false,
    mine: false,
  });
  assert.deepEqual(body.belege[1], {
    id: 'exp_Neu',
    number: '2026-112',
    status: 'open',
    description: 'REWE – Grillgut',
    date: '2026-09-30',
    amountCent: -1234,
    openCent: -1234,
    paidBy: 'Alex Beispiel',
    costUnits: [{ id: 'cun_Lager', name: 'Stammeslager 2026' }],
    categories: [{ id: 'cat_Essen', name: 'Verpflegung', costUnitId: 'cun_Lager' }],
    pages: 1,
    fileName: null,
    uploadedAt: '2026-10-21 19:00:00',
    viaWebsite: true,
    submittedByMe: true,
    mine: true,
  });
  // The file name of a booked receipt often names who uploaded it, so it stays in CampFlow
  assert.equal(body.belege[2]!.fileName, null);
  assert.doesNotMatch(JSON.stringify(body), /Mustermann/);

  // Everyone else sees the same list, without the mark
  const other = await campflowList(context, {
    ...PRINCIPAL,
    userDetails: 'andere@example.test',
    userRoles: STAFF_ROLES,
  });
  const otherBelege = (other.jsonBody as { belege: Json[] }).belege;
  assert.equal(otherBelege.length, 3);
  assert.deepEqual(
    otherBelege.map((beleg) => [beleg.viaWebsite, beleg.submittedByMe, beleg.mine]),
    [
      [false, false, false],
      [true, false, false],
      [false, false, false],
    ]
  );
  assert.deepEqual(refreshes, [true, false]);
});

dbTest('a missing CampFlow login or a broken answer tells whom to ask', async (t) => {
  const answers = [
    () => Response.json({ error: 'CampFlow-Zugang ist nicht konfiguriert' }, { status: 503 }),
    () => Response.json({ loadedAt: 'gestern', receipts: [] }),
  ];
  const { context } = setup(t, () => answers.shift()!());
  for (const expected of [/kein CampFlow-Zugang/, /in ein paar Minuten/]) {
    const response = await campflowList(context);
    assert.equal(response.status, 502);
    assert.match(JSON.stringify(response.jsonBody), expected);
    assert.match(JSON.stringify(response.jsonBody), /admin@stamm-phoenix\.de/);
  }
});

test('CampFlow gets a unique file name, the Auslage and shop and note in the description', () => {
  const beleg = {
    id: '42',
    shop: 'Bäckerei: "Huber"',
    date: '2026-10-01',
    amountCent: 500,
    paidBy: ' Kim ',
    payout: false,
    note: 'Frühstück',
  } as StoredBeleg;
  assert.equal(
    campflowFileName(beleg, null),
    '2026-10-01 Bäckerei Huber 5,00 EUR (Website-Beleg 42).jpg'
  );
  // Previews number their receipts like production, so their names name the preview
  assert.equal(
    campflowFileName(beleg, 'website-pr-416'),
    '2026-10-01 Bäckerei Huber 5,00 EUR (Website-Beleg pr-416-42).jpg'
  );
  assert.notEqual(
    campflowFileName(beleg, 'website-pr-416'),
    campflowFileName(beleg, 'website-pr-417')
  );
  assert.equal(campflowDisburser(beleg), null);
  assert.equal(campflowDescription(beleg), 'Bäckerei: "Huber" – Frühstück');
  assert.equal(campflowDisburser({ ...beleg, payout: true }), 'Kim');
  assert.equal(campflowDisburser({ ...beleg, payout: true, paidBy: 'Sparbuch' }), 'Sparbuch');
  assert.equal(campflowDescription({ ...beleg, payout: true, note: '' }), 'Bäckerei: "Huber"');
  const longName = campflowFileName({ ...beleg, shop: 'x'.repeat(300) }, 'website-pr-99999');
  assert.ok(longName.length <= 200 && longName.endsWith('(Website-Beleg pr-99999-42).jpg'));
  // A long note is shortened
  const long = campflowDescription({ ...beleg, note: 'y'.repeat(400) });
  assert.equal(long.length, 255);
  assert.ok(long.endsWith('y…'), long.slice(-30));
});
