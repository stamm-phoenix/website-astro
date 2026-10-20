import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { StaffChangelog } from '../endpoints/intern-neuigkeiten';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function setup(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'neuigkeiten-test' });
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
    url: 'http://localhost/api/intern/neuigkeiten',
    method,
    headers,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

async function load(context: InvocationContext, principal: unknown = PRINCIPAL): Promise<unknown> {
  const response = await StaffChangelog(request('GET', undefined, principal), context);
  assert.equal(response.status, 200);
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  return (response.jsonBody as { lastSeenId: unknown }).lastSeenId;
}

async function save(context: InvocationContext, lastSeenId: string): Promise<unknown> {
  const response = await StaffChangelog(request('PUT', { lastSeenId }), context);
  assert.equal(response.status, 200);
  return (response.jsonBody as { lastSeenId: unknown }).lastSeenId;
}

test('the seen changelog rejects anonymous and non-staff identities before the database', async (t) => {
  const context = setup(t);
  for (const principal of [null, { ...PRINCIPAL, identityProvider: 'github' }]) {
    for (const method of ['GET', 'PUT']) {
      const response = await StaffChangelog(
        request(method, { lastSeenId: '2026-10-20-04-neuigkeiten' }, principal),
        context
      );
      assert.equal(response.status, 401);
    }
  }
});

test('only IDs of changelog entries are accepted', async (t) => {
  const context = setup(t);
  for (const lastSeenId of [
    '',
    'neuigkeiten',
    '2026-10-20',
    '2026-10-20-neuigkeiten',
    '2026-10-20-04-Neu',
    42,
    null,
    'x'.repeat(90),
  ]) {
    const response = await StaffChangelog(request('PUT', { lastSeenId }), context);
    assert.equal(response.status, 400);
  }
});

dbTest('the newest seen entry is kept per account and never goes back', async (t) => {
  const context = setup(t);
  const other = { ...PRINCIPAL, userId: 'other-staff', userDetails: 'other@example.test' };
  assert.equal(await load(context), null);

  assert.equal(await save(context, '2026-10-14-01-protokolle'), '2026-10-14-01-protokolle');
  assert.equal(await save(context, '2026-10-20-04-neuigkeiten'), '2026-10-20-04-neuigkeiten');
  // A device with an old page reports an older entry: the newer one stays
  assert.equal(await save(context, '2026-10-05-01-abrechnung'), '2026-10-20-04-neuigkeiten');
  assert.equal(await load(context), '2026-10-20-04-neuigkeiten');
  assert.equal(await load(context, other), null);
});
