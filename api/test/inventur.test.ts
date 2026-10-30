import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  InventurCollection,
  InventurItem,
  InventurZaehlung,
} from '../endpoints/intern-pflege-inventur';
import { seedPreviewInventur } from '../lib/db-preview-inventur';
import type { InventarArtikel } from '../lib/inventur-model';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';
const BEN = 'ben.beobachter@stamm-phoenix.de';

function request(
  login: string | null,
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  headers: Record<string, string> = {}
): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated', 'team_leitende'],
  };
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/inventur',
    method,
    headers: {
      'content-type': 'application/json',
      ...(login
        ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
        : {}),
      ...headers,
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'inventur-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

const pullis = {
  bezeichnung: 'Stammespulli',
  kategorie: 'kleidung',
  einheit: 'Stück',
  lagerort: 'Heimkeller',
  zustand: 'gut',
  varianten: [
    { id: null, bezeichnung: 'S', bestand: 4 },
    { id: null, bezeichnung: 'M', bestand: 6 },
  ],
};

async function list(context: InvocationContext): Promise<InventarArtikel[]> {
  return (await InventurCollection(request(ANNA, 'GET'), context)).jsonBody as InventarArtikel[];
}

dbTest('logged-out people can neither read nor change the stock', async (t) => {
  const context = quietContext(t);
  for (const response of [
    await InventurCollection(request(null, 'GET'), context),
    await InventurCollection(request(null, 'POST', {}, pullis), context),
    await InventurItem(
      request(null, 'DELETE', { id: '1' }, undefined, { 'if-match': '"x"' }),
      context
    ),
    await InventurZaehlung(request(null, 'POST', { id: '1' }, { varianten: [] }), context),
  ])
    assert.equal(response.status, 401);
});

dbTest('an article keeps its stock, sizes and place after loading again', async (t) => {
  const context = quietContext(t);
  const created = await InventurCollection(request(ANNA, 'POST', {}, pullis), context);
  assert.equal(created.status, 201, JSON.stringify(created.jsonBody));
  const [artikel] = await list(context);
  assert.equal(artikel.bezeichnung, 'Stammespulli');
  assert.equal(artikel.lagerort, 'Heimkeller');
  assert.equal(artikel.bestand, 10);
  assert.deepEqual(
    artikel.varianten.map((v) => [v.bezeichnung, v.bestand]),
    [
      ['S', 4],
      ['M', 6],
    ]
  );
  assert.equal(artikel.varianten[0].gezaehltAm, null);
});

dbTest('invalid input is refused with the field names', async (t) => {
  const context = quietContext(t);
  const response = await InventurCollection(
    request(ANNA, 'POST', {}, { ...pullis, bezeichnung: '', varianten: [] }),
    context
  );
  assert.equal(response.status, 400);
  assert.deepEqual(
    Object.keys((response.jsonBody as { fields: Record<string, string> }).fields).sort(),
    ['bezeichnung', 'varianten']
  );
});

dbTest('a change keeps, renames, adds and removes variants', async (t) => {
  const context = quietContext(t);
  await InventurCollection(request(ANNA, 'POST', {}, pullis), context);
  const [artikel] = await list(context);
  const [s] = artikel.varianten;
  const changed = await InventurItem(
    request(
      ANNA,
      'PATCH',
      { id: String(artikel.id) },
      {
        ...pullis,
        zustand: 'reparatur',
        fehlend: 'Ein Ärmel ist ausgefranst.',
        varianten: [
          { id: s.id, bezeichnung: 'Small', bestand: 5 },
          { id: null, bezeichnung: 'XL', bestand: 1 },
        ],
        etag: artikel.etag,
      }
    ),
    context
  );
  assert.equal(changed.status, 204, JSON.stringify(changed.jsonBody));
  const [after] = await list(context);
  assert.equal(after.zustand, 'reparatur');
  assert.equal(after.fehlend, 'Ein Ärmel ist ausgefranst.');
  assert.deepEqual(
    after.varianten.map((v) => [v.bezeichnung, v.bestand]),
    [
      ['Small', 5],
      ['XL', 1],
    ]
  );
  // The kept variant keeps its ID, so later links to it stay valid
  assert.equal(after.varianten[0].id, s.id);
});

dbTest('a change on an outdated version is refused with a conflict', async (t) => {
  const context = quietContext(t);
  await InventurCollection(request(ANNA, 'POST', {}, pullis), context);
  const [artikel] = await list(context);
  const first = await InventurItem(
    request(
      ANNA,
      'PATCH',
      { id: String(artikel.id) },
      { ...pullis, varianten: artikel.varianten, etag: artikel.etag }
    ),
    context
  );
  assert.equal(first.status, 204, JSON.stringify(first.jsonBody));
  const stale = await InventurItem(
    request(
      BEN,
      'PATCH',
      { id: String(artikel.id) },
      { ...pullis, varianten: artikel.varianten, etag: artikel.etag }
    ),
    context
  );
  assert.equal(stale.status, 409);
  const staleDelete = await InventurItem(
    request(BEN, 'DELETE', { id: String(artikel.id) }, undefined, { 'if-match': artikel.etag }),
    context
  );
  assert.equal(staleDelete.status, 409);
  const missing = await InventurItem(
    request(BEN, 'PATCH', { id: '999999' }, { ...pullis, etag: artikel.etag }),
    context
  );
  assert.equal(missing.status, 404);
});

dbTest('a count stores stock, time and counting person, and needs every variant', async (t) => {
  const context = quietContext(t);
  await InventurCollection(request(ANNA, 'POST', {}, pullis), context);
  const [artikel] = await list(context);
  const [s, m] = artikel.varianten;
  const partial = await InventurZaehlung(
    request(
      BEN,
      'POST',
      { id: String(artikel.id) },
      { varianten: [{ id: s.id, bestand: 1 }], etag: artikel.etag }
    ),
    context
  );
  assert.equal(partial.status, 400);
  const counted = await InventurZaehlung(
    request(
      BEN,
      'POST',
      { id: String(artikel.id) },
      {
        varianten: [
          { id: s.id, bestand: 3 },
          { id: m.id, bestand: 0 },
        ],
        etag: artikel.etag,
      }
    ),
    context
  );
  assert.equal(counted.status, 204, JSON.stringify(counted.jsonBody));
  const [after] = await list(context);
  assert.deepEqual(
    after.varianten.map((v) => [v.bestand, v.gezaehltVon]),
    [
      [3, BEN],
      [0, BEN],
    ]
  );
  assert.ok(after.varianten[0].gezaehltAm);
  // The count moved the version on: counting from the old view is a conflict
  const stale = await InventurZaehlung(
    request(
      ANNA,
      'POST',
      { id: String(artikel.id) },
      {
        varianten: [
          { id: s.id, bestand: 9 },
          { id: m.id, bestand: 9 },
        ],
        etag: artikel.etag,
      }
    ),
    context
  );
  assert.equal(stale.status, 409);
});

dbTest('deleting an article removes its variants', async (t) => {
  const context = quietContext(t);
  await InventurCollection(request(ANNA, 'POST', {}, pullis), context);
  const [artikel] = await list(context);
  const deleted = await InventurItem(
    request(ANNA, 'DELETE', { id: String(artikel.id) }, undefined, { 'if-match': artikel.etag }),
    context
  );
  assert.equal(deleted.status, 204);
  assert.deepEqual(await list(context), []);
});

dbTest('the preview data is created once', async (t) => {
  const context = quietContext(t);
  await seedPreviewInventur();
  const first = await list(context);
  await seedPreviewInventur();
  assert.equal((await list(context)).length, first.length);
  assert.ok(first.some((artikel) => artikel.kategorie === 'zelt' && artikel.fehlend));
});
