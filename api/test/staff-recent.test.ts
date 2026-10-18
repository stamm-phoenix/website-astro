import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffRecent } from '../endpoints/intern-zuletzt';
import { MAX_RECENT } from '../lib/staff-recent';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function setup(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'zuletzt-test' });
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
    url: 'http://localhost/api/intern/zuletzt',
    method,
    headers,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

async function load(context: InvocationContext, principal: unknown = PRINCIPAL): Promise<unknown> {
  const response = await StaffRecent(request('GET', undefined, principal), context);
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  return (response.jsonBody as { modules: unknown }).modules;
}

async function visit(context: InvocationContext, module: string): Promise<unknown> {
  const response = await StaffRecent(request('POST', { module }), context);
  assert.equal(response.status, 200);
  return (response.jsonBody as { modules: unknown }).modules;
}

test('recent areas reject anonymous and non-staff identities before accessing the database', async (t) => {
  const context = setup(t);
  for (const principal of [null, { ...PRINCIPAL, identityProvider: 'github' }]) {
    for (const method of ['GET', 'POST']) {
      const response = await StaffRecent(
        request(method, { module: '/leitendenbereich/belege' }, principal),
        context
      );
      assert.equal(response.status, 401);
    }
  }
});

test('only paths of the Leitendenbereich are recorded', async (t) => {
  const context = setup(t);
  for (const module of ['/blog', 'https://example.test/leitendenbereich', 42, null]) {
    const response = await StaffRecent(request('POST', { module }), context);
    assert.equal(response.status, 400);
  }
});

dbTest('recent areas are kept per account, the latest first and without repeats', async (t) => {
  const context = setup(t);
  const other = { ...PRINCIPAL, userId: 'other-staff', userDetails: 'other@example.test' };
  assert.deepEqual(await load(context), []);

  await visit(context, '/leitendenbereich/belege');
  await visit(context, '/leitendenbereich/aufgaben/');
  assert.deepEqual(await visit(context, '/leitendenbereich/belege'), [
    '/leitendenbereich/belege',
    '/leitendenbereich/aufgaben',
  ]);
  assert.deepEqual(await load(context), ['/leitendenbereich/belege', '/leitendenbereich/aufgaben']);
  assert.deepEqual(await load(context, other), []);

  for (let index = 0; index < MAX_RECENT + 2; index++) {
    await visit(context, `/leitendenbereich/modul-${index}`);
  }
  const modules = (await load(context)) as string[];
  assert.equal(modules.length, MAX_RECENT);
  assert.equal(modules[0], `/leitendenbereich/modul-${MAX_RECENT + 1}`);
});
