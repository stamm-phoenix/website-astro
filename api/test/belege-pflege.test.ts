import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import { getBelege } from '../lib/beleg-list';
import { getStaffAktionen } from '../lib/aktionen-list';
import {
  seedPreviewAktionen,
  seedPreviewBelege,
  seedPreviewBelegeCampflow,
} from '../lib/db-preview';
import { overrideConfig } from './fixtures/config';
import * as mail from '../lib/mail';
import * as taskDirectory from '../lib/task-directory';
import {
  beforeDeadline,
  BelegeCollection,
  BelegItem,
  BelegPhoto,
  BelegRolle,
  downloadFileName,
  todayInBerlin,
} from '../endpoints/intern-pflege-belege';
import { validateBeleg } from '../lib/validation/beleg';
import { ValidationError } from '../lib/validation/errors';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';
import { INPUT, jpeg, PRINCIPAL, request, setup, STAFF_ROLES } from './fixtures/belege';

/** A JPEG that can be decoded, for previews. */
async function realJpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#f4f1e8' } })
      .jpeg()
      .toBuffer()
  );
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
        kostenstelle: 'Sommerlager 2026',
        kategorie: 'Verpflegungskosten',
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
      art: 'Ausgabe',
      ...INPUT,
      aktion: '',
      status: 'Eingereicht',
      reviewNote: '',
      submittedBy: 'staff@example.test',
      submittedAt: undefined,
      hasImage: true,
      hasOriginal: false,
      isPdf: false,
      aiCheck: null,
      campflow: null,
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

dbTest('who laid out the money sees the receipt someone else submitted, read only', async (t) => {
  const { context, blobs } = setup(t);
  // Both receipts name Alex Beispiel as Auslage; Alex submitted neither
  await store(
    blobs,
    { id: 1, submittedBy: 'sam@example.test', photo: 'beleg-1-scan.jpg' },
    { id: 2, submittedBy: 'sam@example.test' }
  );
  await getDb()
    .updateTable('organisation.beleg')
    .set({ payout: false, paid_by: '' })
    .where('id', '=', 2)
    .execute();
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { login: 'alex@example.test', name: 'Alex Beispiel', givenName: 'Alex' },
  ]);
  const alex = { ...PRINCIPAL, userDetails: 'alex@example.test', userRoles: STAFF_ROLES };

  const response = await BelegeCollection(request('GET', undefined, { principal: alex }), context);
  assert.equal(response.status, 200);
  const items = response.jsonBody as { id: string; readOnly?: boolean; mine?: boolean }[];
  // Only the Auslage, not the one the Stamm paid; marked as theirs, the browser knows no names
  assert.deepEqual(
    items.map(({ id, readOnly, mine }) => [id, readOnly, mine]),
    [['1', true, true]]
  );
  const photo = await BelegPhoto(
    request('GET', undefined, { id: '1', principal: alex, query: '?thumb=1' }),
    context
  );
  assert.equal(photo.status, 200);

  // Looking only: no saving, no new photo, no deleting
  const etag = await version(1);
  const patched = await BelegItem(
    request('PATCH', { ...INPUT, etag }, { id: '1', principal: alex, etag }),
    context
  );
  assert.equal(patched.status, 403, JSON.stringify(patched.jsonBody));
  const replaced = await BelegPhoto(
    request('PUT', { photo: 'x' }, { id: '1', principal: alex, etag }),
    context
  );
  assert.equal(replaced.status, 404);
  const deleted = await BelegItem(
    request('DELETE', undefined, { id: '1', principal: alex, etag }),
    context
  );
  assert.equal(deleted.status, 403);
  // Others still do not see it
  const other = await BelegeCollection(
    request('GET', undefined, {
      principal: { ...PRINCIPAL, userDetails: 'kim@example.test', userRoles: STAFF_ROLES },
    }),
    context
  );
  assert.deepEqual(other.jsonBody, []);
});

dbTest('uploaders get only their own receipts from the database, unchanged', async (t) => {
  const { context, blobs } = setup(t);
  await store(
    blobs,
    { id: 1, submittedBy: 'Leitung@Example.test', submittedAt: '2026-09-02T10:00:00.000Z' },
    { id: 2, submittedBy: 'other@example.test', submittedAt: '2026-09-03T10:00:00.000Z' },
    { id: 3, status: 'Abgelehnt', submittedAt: '2026-09-01T10:00:00.000Z', photo: 'beleg-3.jpg' },
    { id: 4, submittedBy: '', submittedAt: '2026-08-01T10:00:00.000Z' },
    { id: 5, submittedAt: '2026-09-02T10:00:00.000Z', photo: 'beleg-5-scan.jpg' }
  );
  await getDb()
    .updateTable('organisation.beleg')
    .set({
      ai_check: '{"ok":false,"issues":["Unscharf."],"shop":"REWE","amountCent":1234}',
      review_note: 'Bitte neu fotografieren.',
      beleg_date: null,
    })
    .where('id', '=', 3)
    .execute();
  const list = async (userDetails: string) => {
    const response = await BelegeCollection(
      request('GET', undefined, {
        principal: {
          ...PRINCIPAL,
          userDetails,
          userRoles: userDetails === 'kasse@example.test' ? PRINCIPAL.userRoles : STAFF_ROLES,
        },
      }),
      context
    );
    assert.equal(response.status, 200);
    return (response.jsonBody as { etag: string }[]).map(({ etag, ...beleg }) => {
      assert.match(etag, /^"[0-9a-f]{16}"$/);
      return beleg;
    });
  };
  const beleg = (id: number, submittedBy: string, submittedAt: string) => ({
    id: String(id),
    art: 'Ausgabe',
    shop: 'REWE',
    date: '2026-09-30',
    amountCent: 1234,
    paidBy: 'Alex Beispiel',
    payout: true,
    aktion: '',
    kostenstelle: 'Sommerlager 2026',
    kategorie: 'Verpflegungskosten',
    note: '',
    status: 'Eingereicht',
    reviewNote: '',
    submittedBy,
    submittedAt,
    hasImage: false,
    hasOriginal: false,
    isPdf: false,
    aiCheck: null as unknown,
    campflow: null,
  });
  const first = beleg(1, 'Leitung@Example.test', '2026-09-02T10:00:00.000Z');
  const own = {
    ...beleg(5, 'leitung@example.test', '2026-09-02T10:00:00.000Z'),
    hasImage: true,
    hasOriginal: true,
  };
  const rejected = {
    ...beleg(3, 'leitung@example.test', '2026-09-01T10:00:00.000Z'),
    date: '',
    status: 'Abgelehnt',
    reviewNote: 'Bitte neu fotografieren.',
    hasImage: true,
    aiCheck: {
      ok: false,
      isReceipt: false,
      complete: false,
      readable: false,
      issues: ['Unscharf.'],
      restrictedItems: [],
      shop: 'REWE',
      date: null,
      amountCent: 1234,
      checkedAt: '',
    },
  };

  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => []);
  const queries = recordQueries(t);
  assert.deepEqual(await list('leitung@example.test'), [own, first, rejected]);
  // The filter runs in the database, so other people's receipts are never read
  const read = queries.statements.filter((statement) =>
    statement.includes('"organisation"."beleg"')
  );
  assert.equal(read.length, 1);
  assert.match(read[0] ?? '', /where "b"\."submitted_by" = @1/);
  assert.deepEqual(await list('nobody@example.test'), []);
  assert.deepEqual(await list('kasse@example.test'), [
    beleg(2, 'other@example.test', '2026-09-03T10:00:00.000Z'),
    own,
    first,
    rejected,
    beleg(4, '', '2026-08-01T10:00:00.000Z'),
  ]);
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
  assert.deepEqual(patched.jsonBody, { mailed: false, etag: await version(7) });
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
  assert.equal((response.jsonBody as { mailed: boolean }).mailed, false);
  assert.equal((await getBelege())[0]?.status, 'Abgelehnt');
  assert.equal(send.mock.callCount(), 0);

  await reset();
  CONFIG.mail.belegeSender = 'kasse@example.test';
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal((response.jsonBody as { mailed: boolean }).mailed, true);
  const [to, subject, html, sender] = send.mock.calls[0].arguments;
  assert.equal(to, 'leitung@example.test');
  assert.equal(subject, 'Beleg abgelehnt: REWE');
  assert.equal(sender, 'kasse@example.test');
  assert.match(String(html), /Foto &lt;unscharf&gt;/);
  assert.match(String(html), /30\.09\.2026 über 12,34/);
  assert.match(String(html), /\/leitendenbereich\/belege/);
  assert.match(String(html), /staff@example\.test/);
  // The decision is saved already, so the mail stays within the request's time
  const options = send.mock.calls[0].arguments[5] as { retry?: boolean; timeoutMs?: number };
  assert.equal(options.retry, false);
  assert.ok(
    options.timeoutMs !== undefined && options.timeoutMs > 0 && options.timeoutMs <= 10_000
  );

  // PR previews hold made-up receipts and mail nobody
  await reset();
  const server = CONFIG.database.server;
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal((response.jsonBody as { mailed: boolean }).mailed, false);
  assert.equal(send.mock.callCount(), 1);
  CONFIG.database.server = server;

  // Saving an already rejected receipt again sends no second mail
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal((response.jsonBody as { mailed: boolean }).mailed, false);
  assert.equal(send.mock.callCount(), 1);

  // A failing mail never undoes the saved decision
  await reset();
  send.mock.mockImplementation(async () => {
    throw new Error('mailbox');
  });
  response = await BelegItem(request('PATCH', await reject(), { id: '7' }), context);
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { mailed: boolean }).mailed, false);
  assert.equal((await getBelege())[0]?.status, 'Abgelehnt');
});

test('a mail that hangs past the deadline never holds the answer', async () => {
  const hanging = new Promise<boolean>(() => undefined);
  assert.equal(await beforeDeadline(hanging, Date.now() + 20, false), false);
  assert.equal(await beforeDeadline(Promise.resolve(true), Date.now() + 1_000, false), true);
});

dbTest('submitting and resubmitting a receipt mails the team „Kasse“', async (t) => {
  const { context } = setup(t);
  const warn = t.mock.method(context, 'warn', () => undefined);
  const uploader = { ...PRINCIPAL, userDetails: 'Leitung@Example.test', userRoles: STAFF_ROLES };
  const kasse = (login: string) => ({ name: login, givenName: login, login });
  const directory = t.mock.method(taskDirectory, 'readTaskDirectory', async () => [
    kasse('kasse.eins@stamm-phoenix.de'),
    kasse('kasse.zwei@stamm-phoenix.de'),
    kasse('leitung@example.test'),
  ]);
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { name: 'Lea Leitung', givenName: 'Lea', login: 'leitung@example.test' },
  ]);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  overrideConfig(t, CONFIG.mail, { belegeSender: 'kasse@example.test' });
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');

  const response = await BelegeCollection(
    request('POST', { ...INPUT, note: 'Für <alle>', photo }, { principal: uploader }),
    context
  );
  assert.equal(response.status, 201);
  assert.equal(directory.mock.calls[0]?.arguments[1], CONFIG.staff.teams.kasse.groupId);
  // Everything after saving stays within the request's time, without retries
  assert.ok(directory.mock.calls[0]?.arguments[0] instanceof AbortSignal);
  const options = send.mock.calls[0]?.arguments[5] as { retry?: boolean; timeoutMs?: number };
  assert.equal(options.retry, false);
  assert.ok(
    options.timeoutMs !== undefined && options.timeoutMs > 0 && options.timeoutMs <= 10_000
  );
  // Everyone in the Kasse except the uploader, each with a mail of their own
  assert.deepEqual(
    send.mock.calls.map((call) => call.arguments[0]),
    ['kasse.eins@stamm-phoenix.de', 'kasse.zwei@stamm-phoenix.de']
  );
  const [, subject, html, sender] = send.mock.calls[0].arguments;
  assert.equal(subject, 'Neuer Beleg zur Prüfung: REWE');
  assert.equal(sender, 'kasse@example.test');
  assert.match(String(html), /Lea Leitung hat einen neuen Beleg/);
  assert.match(String(html), /30\.09\.2026/);
  assert.match(String(html), /12,34/);
  assert.match(String(html), /Sommerlager/);
  assert.match(String(html), /Alex Beispiel/);
  assert.match(String(html), /Für &lt;alle&gt;/);
  assert.match(String(html), /http:\/\/localhost\/leitendenbereich\/belege/);

  // Correcting details sends nothing; resubmitting a rejected receipt tells the Kasse again
  const { id } = response.jsonBody as { id: string };
  const patch = async (status: string): Promise<number> =>
    (
      await BelegItem(
        request(
          'PATCH',
          { ...INPUT, status, etag: await version(Number(id)) },
          { id, principal: uploader }
        ),
        context
      )
    ).status ?? 0;
  assert.equal(await patch('Eingereicht'), 200);
  assert.equal(send.mock.callCount(), 2);
  await getDb()
    .updateTable('organisation.beleg')
    .set({ status: 'Abgelehnt' })
    .where('id', '=', Number(id))
    .execute();
  assert.equal(await patch('Eingereicht'), 200);
  assert.equal(send.mock.callCount(), 4);
  assert.equal(send.mock.calls[2].arguments[1], 'Beleg erneut eingereicht: REWE');

  // The Kasse resetting someone else's rejected receipt mails nobody
  await getDb()
    .updateTable('organisation.beleg')
    .set({ status: 'Abgelehnt' })
    .where('id', '=', Number(id))
    .execute();
  const reset = await BelegItem(
    request('PATCH', { ...INPUT, status: 'Eingereicht', etag: await version(Number(id)) }, { id }),
    context
  );
  assert.equal(reset.status, 200);
  assert.equal(send.mock.callCount(), 4);

  // A failing mail or directory never blocks submitting
  send.mock.mockImplementation(async () => {
    throw new Error('mailbox');
  });
  const failing = await BelegeCollection(
    request('POST', { ...INPUT, photo }, { principal: uploader }),
    context
  );
  assert.equal(failing.status, 201);
  directory.mock.mockImplementation(async () => {
    throw new Error('directory');
  });
  const offline = await BelegeCollection(
    request('POST', { ...INPUT, photo }, { principal: uploader }),
    context
  );
  assert.equal(offline.status, 201);
  const warnings = warn.mock.calls.map((call) => String(call.arguments[0]));
  assert.ok(warnings.includes('[belege] Mail an die Kasse an 2 Person(en) fehlgeschlagen'));
  assert.ok(warnings.includes('[belege] Kasse konnte nicht benachrichtigt werden'));

  // Without a sender mailbox and in PR previews nothing is sent
  directory.mock.resetCalls();
  send.mock.resetCalls();
  CONFIG.mail.belegeSender = undefined;
  await BelegeCollection(request('POST', { ...INPUT, photo }, { principal: uploader }), context);
  CONFIG.mail.belegeSender = 'kasse@example.test';
  overrideConfig(t, CONFIG.database, { server: CONFIG.database.previewServer });
  await BelegeCollection(request('POST', { ...INPUT, photo }, { principal: uploader }), context);
  assert.equal(directory.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});

dbTest('only the Kasse sees all receipts and decides; uploaders manage their own', async (t) => {
  const { context, blobs } = setup(t);
  const uploader = { ...PRINCIPAL, userDetails: 'Leitung@Example.test', userRoles: STAFF_ROLES };
  const kasse = { ...PRINCIPAL, userDetails: 'kasse@example.test' };
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
  assert.equal((response.jsonBody as { etag: string }).etag, stored?.etag);
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

dbTest(
  'a PDF is stored with its first page, shown as that page and downloaded as PDF',
  async (t) => {
    const { context, blobs } = setup(t);
    const page = Buffer.from(await realJpeg(1200, 1600));
    const pdf = Buffer.from('%PDF-1.7\n% Rechnung\n%%EOF');
    const body = { ...INPUT, photo: page.toString('base64') };

    for (const invalid of [
      { pdf: Buffer.from('kein PDF').toString('base64') },
      { pdf: pdf.toString('base64'), original: page.toString('base64') },
      { pdf: Buffer.alloc(5 * 1024 * 1024 + 1, 0x25).toString('base64') },
    ]) {
      const response = await BelegeCollection(request('POST', { ...body, ...invalid }), context);
      assert.ok([400, 413].includes(response.status ?? 0), JSON.stringify(response.jsonBody));
    }
    assert.equal(blobs.size, 0);

    const created = await BelegeCollection(
      request('POST', { ...body, pdf: pdf.toString('base64') }),
      context
    );
    assert.equal(created.status, 201);
    const { id } = created.jsonBody as { id: string };
    const [stored] = await getBelege();
    assert.match(stored?.photo ?? '', /^beleg-\d+\.pdf$/);
    assert.equal(stored?.isPdf, true);
    assert.equal(stored?.hasOriginal, false);
    const pageName = (stored?.photo ?? '').replace('.pdf', '-seite.jpg');
    assert.deepEqual(
      [...blobs.keys()].sort(),
      [`belege/${id}/${stored?.photo}`, `belege/${id}/${pageName}`].sort()
    );

    const shown = await BelegPhoto(request('GET', undefined, { id }), context);
    assert.equal((shown.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
    assert.deepEqual(Buffer.from(shown.body as Uint8Array), page);
    const thumb = await BelegPhoto(request('GET', undefined, { id, query: '?thumb=1' }), context);
    assert.equal(thumb.status, 200);
    const download = await BelegPhoto(
      request('GET', undefined, { id, query: '?download=1' }),
      context
    );
    const headers = download.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/pdf');
    assert.match(headers['Content-Disposition'], /2026-09-30 REWE 12,34 EUR\.pdf/);
    assert.deepEqual(Buffer.from(download.body as Uint8Array), pdf);

    // Replaced by a photo, the PDF and its page go
    const replaced = await BelegPhoto(
      request('PUT', { photo: page.toString('base64') }, { id, etag: stored?.etag }),
      context
    );
    assert.equal(replaced.status, 200);
    assert.equal((replaced.jsonBody as { isPdf: boolean }).isPdf, false);
    const [now] = await getBelege();
    assert.deepEqual([...blobs.keys()], [`belege/${id}/${now?.photo}`]);
  }
);

dbTest('income is stored without an Auslage', async (t) => {
  const { context } = setup(t);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const response = await BelegeCollection(
    request('POST', { ...INPUT, art: 'Einnahme', shop: 'Spende Bäckerei', photo }),
    context
  );
  assert.equal(response.status, 201);
  const [stored] = await getBelege();
  assert.equal(stored?.art, 'Einnahme');
  assert.equal(stored?.payout, false);
  assert.equal(stored?.paidBy, '');
});

test('income needs no Auslage, and the kind of receipt must be known', () => {
  const income = validateBeleg(
    { ...INPUT, art: 'Einnahme', payout: true, paidBy: '' },
    '2026-10-01'
  );
  assert.deepEqual([income.art, income.payout, income.paidBy], ['Einnahme', false, '']);
  assert.equal(validateBeleg(INPUT, '2026-10-01').art, 'Ausgabe');
  assert.throws(
    () => validateBeleg({ ...INPUT, art: 'Spende' }, '2026-10-01'),
    (error: unknown) => error instanceof ValidationError && typeof error.fields.art === 'string'
  );
});

test('receipt validation rejects missing, future and implausible values', () => {
  const today = '2026-10-01';
  assert.deepEqual(validateBeleg(INPUT, today), {
    art: 'Ausgabe',
    ...INPUT,
    aktion: '',
    status: 'Eingereicht',
    reviewNote: '',
  });
  // The Aktion is no longer entered: a receipt keeps the one it has
  assert.equal(validateBeleg({ ...INPUT, aktion: 'Lager' }, today).aktion, '');
  assert.equal(validateBeleg(INPUT, today, 'Lager').aktion, 'Lager');
  // An older receipt with only its Aktion may still be saved, e.g. to reject it
  assert.deepEqual(validateBeleg({ ...INPUT, kostenstelle: '', kategorie: '' }, today, 'Lager'), {
    art: 'Ausgabe',
    ...INPUT,
    kostenstelle: '',
    kategorie: '',
    aktion: 'Lager',
    status: 'Eingereicht',
    reviewNote: '',
  });
  // Paid by the Stamm: no Auslage, so nobody to name
  assert.deepEqual(validateBeleg({ ...INPUT, payout: false }, today), {
    art: 'Ausgabe',
    ...INPUT,
    aktion: '',
    paidBy: '',
    payout: false,
    status: 'Eingereicht',
    reviewNote: '',
  });
  assert.equal(validateBeleg({ ...INPUT, payout: false, paidBy: '' }, today).paidBy, '');
  assert.equal(validateBeleg({ ...INPUT, paidBy: 'Sparbuch' }, today).paidBy, 'Sparbuch');
  for (const [body, field] of [
    [{ ...INPUT, shop: ' ' }, 'shop'],
    [{ ...INPUT, paidBy: '' }, 'paidBy'],
    [{ ...INPUT, kostenstelle: '' }, 'kostenstelle'],
    [{ ...INPUT, kategorie: ' ' }, 'kategorie'],
    [{ ...INPUT, kategorie: 'x'.repeat(121) }, 'kategorie'],
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
    downloadFileName({ shop: 'A:B*C', date: '', amountCent: 5, isPdf: false }),
    'Beleg A B C 0,05 EUR.jpg'
  );
  assert.equal(
    downloadFileName({ shop: 'Rechnung', date: '2026-10-01', amountCent: 1250, isPdf: true }),
    '2026-10-01 Rechnung 12,50 EUR.pdf'
  );
});

dbTest('the preview gets invented Aktionen and Belege once', async (t) => {
  const { blobs } = setup(t);
  for (let run = 0; run < 2; run++) {
    await seedPreviewAktionen();
    await seedPreviewBelege();
    await seedPreviewBelegeCampflow();
  }
  const aktionen = await getStaffAktionen();
  assert.equal(aktionen.length, 3);
  assert.ok(aktionen.some((entry) => entry.stufen.includes('Leitende')));
  const belege = await getBelege();
  assert.deepEqual(belege.map((beleg) => beleg.status).sort(), [
    'Abgelehnt',
    'Angenommen',
    'Eingereicht',
  ]);
  assert.equal(belege.filter((beleg) => beleg.hasOriginal).length, 1);
  // Three photos and the original of the scan
  assert.equal(blobs.size, 4);
  // Transferred receipts with IDs of their own, deleted here after the upload
  const transferred = await getDb()
    .selectFrom('organisation.beleg_campflow')
    .select(['beleg_id', 'beleg_deleted_at'])
    .where('state', '=', 'Hochgeladen')
    .execute();
  assert.equal(transferred.length, 2);
  assert.ok(transferred.every((entry) => entry.beleg_deleted_at !== null));
  assert.ok(
    transferred.every((entry) => !belege.some((beleg) => beleg.id === String(entry.beleg_id)))
  );
});
