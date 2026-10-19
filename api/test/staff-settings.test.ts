import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffSettings } from '../endpoints/intern-einstellungen';
import { pickStaffSettings } from '../lib/staff-settings-model';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function setup(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'einstellungen-test' });
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
    url: 'http://localhost/api/intern/einstellungen',
    method,
    headers,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

async function load(context: InvocationContext, principal: unknown = PRINCIPAL): Promise<unknown> {
  const response = await StaffSettings(request('GET', undefined, principal), context);
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  return (response.jsonBody as { settings: unknown }).settings;
}

test('only known keys with valid values are picked', () => {
  assert.deepEqual(pickStaffSettings({ protokollText: 'markdown' }), { protokollText: 'markdown' });
  assert.deepEqual(pickStaffSettings({ protokollText: 'html', other: 1 }), {});
  assert.deepEqual(pickStaffSettings('nope'), {});
  assert.deepEqual(pickStaffSettings(null), {});
});

test('settings reject anonymous and non-staff identities before accessing the database', async (t) => {
  const context = setup(t);
  for (const principal of [null, { ...PRINCIPAL, identityProvider: 'github' }]) {
    for (const method of ['GET', 'PUT']) {
      const response = await StaffSettings(
        request(method, { settings: { protokollText: 'markdown' } }, principal),
        context
      );
      assert.equal(response.status, 401);
    }
  }
});

dbTest('settings are saved per account and merged on every save', async (t) => {
  const context = setup(t);
  const other = { ...PRINCIPAL, userId: 'other-staff', userDetails: 'other@example.test' };
  assert.deepEqual(await load(context), {});

  const saved = await StaffSettings(
    request('PUT', { settings: { protokollText: 'markdown' } }),
    context
  );
  assert.equal(saved.status, 200);
  assert.deepEqual((saved.jsonBody as { settings: unknown }).settings, {
    protokollText: 'markdown',
  });
  assert.deepEqual(await load(context), { protokollText: 'markdown' });
  assert.deepEqual(await load(context, other), {});

  await StaffSettings(request('PUT', { settings: { protokollText: 'formatiert' } }), context);
  assert.deepEqual(await load(context), { protokollText: 'formatiert' });
});

dbTest('settings accept only known keys and values', async (t) => {
  const context = setup(t);
  for (const settings of [
    undefined,
    'nope',
    {},
    { protokollText: 'html' },
    { protokollText: 'markdown', unknown: true },
    { unknown: true },
  ]) {
    const response = await StaffSettings(request('PUT', { settings }), context);
    assert.equal(response.status, 400, JSON.stringify(settings));
  }
  assert.deepEqual(await load(context), {});
});
