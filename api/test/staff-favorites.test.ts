import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffFavorites } from '../endpoints/intern-favoriten';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function setup(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'favoriten-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

function request(method: string, body?: unknown, principal: unknown = PRINCIPAL): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(JSON.stringify(principal)).toString('base64');
  }
  return new HttpRequest({
    url: 'http://localhost/api/intern/favoriten',
    method,
    headers,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

async function load(context: InvocationContext, principal: unknown = PRINCIPAL): Promise<unknown> {
  const response = await StaffFavorites(request('GET', undefined, principal), context);
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  return (response.jsonBody as { modules: unknown }).modules;
}

test('favorites reject anonymous and non-staff identities before accessing the database', async (t) => {
  const context = setup(t);
  for (const principal of [null, { ...PRINCIPAL, identityProvider: 'github' }]) {
    for (const method of ['GET', 'PUT']) {
      const response = await StaffFavorites(request(method, { modules: [] }, principal), context);
      assert.equal(response.status, 401);
    }
  }
});

dbTest('favorites are saved per account and replaced on every save', async (t) => {
  const context = setup(t);
  const other = { ...PRINCIPAL, userId: 'other-staff', userDetails: 'other@example.test' };
  assert.equal(await load(context), null);

  const modules = ['/leitendenbereich/aufgaben', '/leitendenbereich/aktionen'];
  const saved = await StaffFavorites(request('PUT', { modules }), context);
  assert.equal(saved.status, 204);
  assert.deepEqual(await load(context), modules);
  assert.equal(await load(context, other), null);

  await StaffFavorites(request('PUT', { modules: ['/leitendenbereich/aktionen'] }), context);
  assert.deepEqual(await load(context), ['/leitendenbereich/aktionen']);
  await StaffFavorites(request('PUT', { modules: [] }), context);
  assert.deepEqual(await load(context), []);
});

dbTest('favorites accept only paths of the Leitendenbereich', async (t) => {
  const context = setup(t);
  for (const modules of [
    'nope',
    ['https://example.test/'],
    ['/leitendenbereich/../admin'],
    [42],
    Array.from({ length: 51 }, (_, index) => `/leitendenbereich/m${index}`),
  ]) {
    const response = await StaffFavorites(request('PUT', { modules }), context);
    assert.equal(response.status, 400);
  }
  assert.equal(await load(context), null);

  const duplicate = ['/leitendenbereich/aufgaben', '/leitendenbereich/aufgaben'];
  await StaffFavorites(request('PUT', { modules: duplicate }), context);
  assert.deepEqual(await load(context), ['/leitendenbereich/aufgaben']);
});

dbTest('taking over favorites from the browser never replaces saved ones', async (t) => {
  const context = setup(t);
  const old = ['/leitendenbereich/belege'];
  const first = await StaffFavorites(request('PUT', { modules: old, takeover: true }), context);
  assert.equal(first.status, 200);
  assert.deepEqual((first.jsonBody as { modules: string[] }).modules, old);
  assert.deepEqual(await load(context), old);

  // Another device saved meanwhile; a late takeover keeps that choice
  const newer = ['/leitendenbereich/aufgaben'];
  await StaffFavorites(request('PUT', { modules: newer }), context);
  const late = await StaffFavorites(request('PUT', { modules: old, takeover: true }), context);
  assert.deepEqual((late.jsonBody as { modules: string[] }).modules, newer);
  assert.deepEqual(await load(context), newer);
});
