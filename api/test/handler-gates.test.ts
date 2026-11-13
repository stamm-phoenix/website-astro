import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { staffHandler } from '../lib/handler';
import { NIKOLAUS_STAFF_INACTIVE, nikolausGate } from '../lib/nikolaus-staff';
import { ok } from '../lib/pflege-api';
import * as cutover from '../lib/protokoll-cutover';
import { ProtokollMaintenanceError } from '../lib/protokoll-cutover';
import { protokollGate } from '../lib/protokoll-gate';
import { mockNikolausSettings } from './fixtures/nikolaus-settings';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function request(method: string): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/nikolaus-test',
    method,
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext({ functionName: 'gate-test' });
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

function counted(gate = nikolausGate) {
  const calls = { count: 0 };
  const handler = staffHandler(
    'nikolaus-test',
    async () => {
      calls.count++;
      return ok({});
    },
    { gate }
  );
  return { calls, handler };
}

test('the Nikolaus gate refuses reads and writes while the staff modules are off', async (t) => {
  mockNikolausSettings(t, { staffActive: false });
  const { calls, handler } = counted();

  for (const method of ['GET', 'POST']) {
    const response = await handler(request(method), context(t));
    assert.equal(response.status, 403);
    assert.deepEqual(response.jsonBody, NIKOLAUS_STAFF_INACTIVE.jsonBody);
  }
  assert.equal(calls.count, 0);
});

test('the Nikolaus gate stops writes in maintenance mode, reads go on', async (t) => {
  mockNikolausSettings(t, { maintenance: true });
  const { calls, handler } = counted();

  const write = await handler(request('PATCH'), context(t));
  assert.equal(write.status, 503);
  assert.equal((write.jsonBody as { code: string }).code, 'MAINTENANCE');
  assert.equal(new Headers(write.headers).get('cache-control'), 'no-store');
  assert.equal(calls.count, 0);

  const read = await handler(request('GET'), context(t));
  assert.equal(read.status, 200);
  assert.equal(calls.count, 1);
});

test('Nikolaus writes are never stored, reads keep their own headers', async (t) => {
  mockNikolausSettings(t);
  const raw = staffHandler('nikolaus-test', async () => ({ status: 200, jsonBody: {} }), {
    gate: nikolausGate,
  });

  const write = await raw(request('POST'), context(t));
  assert.equal(new Headers(write.headers).get('cache-control'), 'no-store');
  const read = await raw(request('GET'), context(t));
  assert.equal(new Headers(read.headers).get('cache-control'), null);
});

test('the Protokoll gate runs the request inside the cut-over lock', async (t) => {
  const gate = t.mock.method(cutover, 'withProtokollGate', async (work: () => Promise<unknown>) =>
    work()
  );
  const { calls, handler } = counted(protokollGate);

  assert.equal((await handler(request('POST'), context(t))).status, 200);
  assert.equal(gate.mock.callCount(), 1);
  assert.equal(calls.count, 1);
});

test('during the cut-over the Protokolle answer with a maintenance message', async (t) => {
  t.mock.method(cutover, 'withProtokollGate', async () => {
    throw new ProtokollMaintenanceError();
  });
  const { calls, handler } = counted(protokollGate);

  const response = await handler(request('POST'), context(t));
  assert.equal(response.status, 503);
  assert.deepEqual(response.jsonBody, {
    error: 'MAINTENANCE',
    code: 'MAINTENANCE',
    message: 'Die Protokolle werden gerade umgestellt. Bitte später erneut versuchen.',
  });
  assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
  assert.equal(calls.count, 0);
});
