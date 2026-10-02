import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as sharePointRest from '../lib/sharepoint-rest';
import * as environment from '../lib/environment';
import {
  BelegeCollection,
  BelegItem,
  BelegPhoto,
  downloadFileName,
  todayInBerlin,
} from '../endpoints/intern-pflege-belege';
import { validateBeleg, ValidationError } from '../lib/pflege-validation';

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
const VERSION = '"item,3"';

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

function setup(t: TestContext): InvocationContext {
  t.mock.method(environment, 'getEnvironment', (name: environment.EnvironmentVariable) =>
    name === environment.EnvironmentVariable.AZURE_TENANT_ID ? 'our-tenant' : 'belege-list'
  );
  const context = new InvocationContext({ functionName: 'belege-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
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

test('receipt operations reject anonymous identities before accessing SharePoint', async (t) => {
  const context = setup(t);
  const read = t.mock.method(sharePoint, 'getSharePointListItems', async () => []);
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
  assert.equal(read.mock.callCount(), 0);
});

test('submitting a receipt stores details, uploader and photo as unchecked', async (t) => {
  const context = setup(t);
  const log = t.mock.method(context, 'log', () => undefined);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const attach = t.mock.method(sharePointRest, 'addListItemAttachment', async () => undefined);
  const image = t.mock.method(sharePointRest, 'validateUpdateListItem', async () => undefined);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');

  const response = await BelegeCollection(
    request('POST', { ...INPUT, status: 'Geprüft', paidOut: true, photo }),
    context
  );
  assert.equal(response.status, 201);
  assert.deepEqual(response.jsonBody, { id: '7' });
  assert.deepEqual(create.mock.calls[0].arguments, [
    'belege-list',
    {
      Title: 'REWE',
      Belegdatum: '2026-09-30',
      BetragCent: 1234,
      BezahltVon: 'Alex Beispiel',
      Auszahlung: true,
      Aktion: 'Sommerlager',
      Bemerkung: '',
      Status: 'Eingereicht',
      Pruefnotiz: '',
      Ausgezahlt: false,
      EingereichtVon: 'staff@example.test',
    },
  ]);
  const [listId, itemId, fileName] = attach.mock.calls[0].arguments;
  assert.equal(listId, 'belege-list');
  assert.equal(itemId, '7');
  assert.match(String(fileName), /^beleg-\d+\.jpg$/);
  assert.deepEqual(image.mock.calls[0].arguments[2], {
    Beleg: JSON.stringify({ type: 'thumbnail', fileName, fieldName: 'Beleg' }),
  });
  assert.deepEqual(log.mock.calls[0].arguments, ['[pflege] staff@example.test POST belege']);
});

test('receipts without a usable photo are rejected before anything is written', async (t) => {
  const context = setup(t);
  const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
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
  assert.equal(create.mock.callCount(), 0);
});

test('a failed photo upload removes the half-created receipt', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'createSharePointListItem', async () => '7');
  const remove = t.mock.method(sharePoint, 'deleteSharePointListItem', async () => undefined);
  t.mock.method(sharePointRest, 'addListItemAttachment', async () => {
    throw new sharePointRest.SharePointRestError(500, 'boom');
  });
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');
  const response = await BelegeCollection(request('POST', { ...INPUT, photo }), context);
  assert.equal(response.status, 500);
  assert.deepEqual(remove.mock.calls[0].arguments, ['belege-list', '7']);
});

test('the receipt list maps SharePoint fields and sorts the newest first', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => [
    {
      id: '1',
      eTag: '"a,1"',
      createdDateTime: '2026-09-01T10:00:00Z',
      fields: { Title: 'Bauhaus', BetragCent: 500, Status: 'Unbekannt' },
    },
    {
      id: '2',
      eTag: VERSION,
      createdDateTime: '2026-09-30T10:00:00Z',
      fields: {
        Title: 'REWE',
        Belegdatum: '2026-09-30',
        BetragCent: 1234,
        BezahltVon: 'Alex Beispiel',
        Auszahlung: true,
        Aktion: 'Sommerlager',
        Status: 'Rückfrage',
        Pruefnotiz: 'Unscharf',
        EingereichtVon: 'staff@example.test',
        Beleg: JSON.stringify({ fileName: 'beleg-1.jpg' }),
      },
    },
  ]);
  const response = await BelegeCollection(request('GET'), context);
  assert.equal(response.status, 200);
  const items = response.jsonBody as { id: string; status: string; hasImage: boolean }[];
  assert.deepEqual(
    items.map(({ id, status, hasImage }) => ({ id, status, hasImage })),
    [
      { id: '2', status: 'Rückfrage', hasImage: true },
      { id: '1', status: 'Eingereicht', hasImage: false },
    ]
  );
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
});

test('reviewing and deleting receipts require the loaded version', async (t) => {
  const context = setup(t);
  const update = t.mock.method(sharePoint, 'updateSharePointListItem', async () => undefined);
  const remove = t.mock.method(sharePoint, 'deleteSharePointListItem', async () => undefined);
  const review = { ...INPUT, status: 'Geprüft', paidOut: true, reviewNote: '' };

  assert.equal((await BelegItem(request('PATCH', review, { id: '7' }), context)).status, 400);
  assert.equal((await BelegItem(request('DELETE', undefined, { id: '7' }), context)).status, 400);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);

  const patched = await BelegItem(
    request('PATCH', { ...review, etag: VERSION }, { id: '7' }),
    context
  );
  assert.equal(patched.status, 204);
  assert.deepEqual(update.mock.calls[0].arguments.slice(2), [
    {
      Title: 'REWE',
      Belegdatum: '2026-09-30',
      BetragCent: 1234,
      BezahltVon: 'Alex Beispiel',
      Auszahlung: true,
      Aktion: 'Sommerlager',
      Bemerkung: '',
      Status: 'Geprüft',
      Pruefnotiz: '',
      Ausgezahlt: true,
    },
    VERSION,
  ]);

  update.mock.mockImplementation(async () => {
    throw new sharePointRest.SharePointRestError(412, 'changed');
  });
  const conflict = await BelegItem(
    request('PATCH', { ...review, etag: VERSION }, { id: '7' }),
    context
  );
  assert.equal(conflict.status, 409);

  assert.equal(
    (await BelegItem(request('DELETE', undefined, { id: '7', etag: VERSION }), context)).status,
    204
  );
  assert.deepEqual(remove.mock.calls[0].arguments, ['belege-list', '7', VERSION]);
});

test('the photo is served privately and as a named download', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItem', async () => ({
    id: '7',
    eTag: VERSION,
    fields: {
      Title: 'REWE / Markt',
      Belegdatum: '2026-09-30',
      BetragCent: 1234,
      Beleg: JSON.stringify({ fileName: 'beleg-1.jpg' }),
    },
  }));
  const bytes = jpeg(1200, 1600);
  const load = t.mock.method(sharePointRest, 'getListItemAttachment', async () => bytes);

  const inline = await BelegPhoto(request('GET', undefined, { id: '7' }), context);
  assert.equal(inline.status, 200);
  assert.equal(inline.body, bytes);
  const headers = inline.headers as Record<string, string>;
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Content-Type'], 'image/jpeg');
  assert.equal(headers['Content-Disposition'], undefined);
  assert.deepEqual(load.mock.calls[0].arguments, ['belege-list', '7', 'beleg-1.jpg']);

  const download = await BelegPhoto(
    request('GET', undefined, { id: '7', query: '?download=1' }),
    context
  );
  assert.match(
    (download.headers as Record<string, string>)['Content-Disposition'],
    /filename="2026-09-30 REWE Markt 12,34 EUR\.jpg"/
  );
});

test('replacing the photo checks the version and removes the old attachment', async (t) => {
  const context = setup(t);
  t.mock.method(sharePoint, 'getSharePointListItem', async () => ({
    id: '7',
    eTag: VERSION,
    fields: { Beleg: JSON.stringify({ fileName: 'beleg-1.jpg' }) },
  }));
  const attach = t.mock.method(sharePointRest, 'addListItemAttachment', async () => undefined);
  t.mock.method(sharePointRest, 'validateUpdateListItem', async () => undefined);
  const detach = t.mock.method(sharePointRest, 'deleteListItemAttachment', async () => undefined);
  const photo = jpeg(1200, 1600);

  assert.equal(
    (await BelegPhoto(request('PUT', photo, { id: '7', etag: '"item,2"' }), context)).status,
    409
  );
  assert.equal(attach.mock.callCount(), 0);

  const response = await BelegPhoto(request('PUT', photo, { id: '7', etag: VERSION }), context);
  assert.equal(response.status, 200);
  assert.equal(attach.mock.callCount(), 1);
  assert.deepEqual(detach.mock.calls[0].arguments, ['belege-list', '7', 'beleg-1.jpg']);
});

test('receipt validation rejects missing, future and implausible values', () => {
  const today = '2026-10-01';
  assert.deepEqual(validateBeleg({ ...INPUT, payout: false, paidOut: true }, today), {
    ...INPUT,
    payout: false,
    status: 'Eingereicht',
    reviewNote: '',
    paidOut: false,
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
    [{ ...INPUT, status: 'Rückfrage', reviewNote: '' }, 'reviewNote'],
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
      paidOut: false,
      submittedBy: '',
      submittedAt: '',
      hasImage: true,
    }),
    'Beleg A B C 0,05 EUR.jpg'
  );
});
