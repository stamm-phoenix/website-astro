import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import * as env from '../lib/environment';
import { getBelege } from '../lib/beleg-list';
import { campflowDescription, campflowDisburser, campflowFileName } from '../lib/beleg-campflow';
import type { StoredBeleg } from '../lib/beleg-list';
import { BelegCampflow, BelegeUebertragen, BelegItem } from '../endpoints/intern-pflege-belege';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import test from 'node:test';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'kasse@example.test',
  userRoles: ['authenticated'],
};
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

    overrideConfig(t, CONFIG.belege, { reviewers: ['kasse@example.test'] });
    const other = { ...PRINCIPAL, userDetails: 'leitung@example.test' };
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
  const history = (await transferred(context)).jsonBody as { id: string; amountCent: number }[];
  assert.deepEqual(
    history.map(({ id, amountCent }) => ({ id, amountCent })),
    [{ id: '7', amountCent: 1234 }]
  );
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
  const history = (await transferred(context)).jsonBody as { id: string; number: string }[];
  assert.deepEqual(
    history.map(({ id, number }) => ({ id, number })),
    [{ id: '7', number: '2026-112' }]
  );
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

function transferred(
  context: InvocationContext,
  principal = PRINCIPAL
): ReturnType<typeof BelegeUebertragen> {
  return BelegeUebertragen(
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/belege/uebertragen',
      method: 'GET',
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
    }),
    context
  );
}

dbTest('transferred receipts stay listed with their details, for the uploader too', async (t) => {
  const answers: Array<() => Response> = [
    () => uploaded(),
    () => Response.json({ error: 'Kategorie fehlt' }, { status: 404 }),
  ];
  const { context, blobs } = setup(t, () => answers.shift()!());
  const first = await store(blobs, 7, { payout: false });
  const second = await store(blobs, 8);
  assert.equal((await transfer(context, 7, { etag: first, ...CHOICE })).status, 200);
  assert.equal((await transfer(context, 8, { etag: second, ...CHOICE })).status, 502);

  overrideConfig(t, CONFIG.belege, { reviewers: ['kasse@example.test'] });
  const kasse = await transferred(context);
  assert.equal(kasse.status, 200);
  assert.deepEqual(kasse.jsonBody, [
    {
      id: '7',
      shop: 'REWE',
      date: '2026-09-30',
      amountCent: 1234,
      paidBy: 'Alex Beispiel',
      payout: false,
      aktion: 'Stammeslager 2026',
      note: 'Grillgut',
      submittedBy: 'leitung@example.test',
      number: '2026-112',
      costUnitName: 'Stammeslager 2026',
      categoryName: 'Verpflegung',
      transferredBy: 'kasse@example.test',
      transferredAt: (kasse.jsonBody as { transferredAt: string }[])[0]!.transferredAt,
    },
  ]);

  const uploader = { ...PRINCIPAL, userDetails: 'Leitung@Example.test' };
  assert.equal(((await transferred(context, uploader)).jsonBody as unknown[]).length, 1);
  const other = { ...PRINCIPAL, userDetails: 'andere@example.test' };
  assert.deepEqual((await transferred(context, other)).jsonBody, []);
});

test('CampFlow gets a unique file name, the payout person and the rest in the description', () => {
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
    campflowFileName(beleg),
    '2026-10-01 Bäckerei Huber 5,00 EUR (Website-Beleg 42).jpg'
  );
  assert.equal(campflowDisburser(beleg), null);
  assert.equal(campflowDescription(beleg), 'Bäckerei: "Huber" – Frühstück – bezahlt von Kim');
  assert.equal(campflowDisburser({ ...beleg, payout: true }), 'Kim');
  assert.equal(campflowDescription({ ...beleg, payout: true, note: '' }), 'Bäckerei: "Huber"');
  const long = campflowFileName({ ...beleg, shop: 'x'.repeat(300) });
  assert.ok(long.length <= 200 && long.endsWith('(Website-Beleg 42).jpg'));
  assert.equal(campflowDescription({ ...beleg, note: 'y'.repeat(400) }).length, 255);
});
