import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext, type HttpResponseInit } from '@azure/functions';
import { RecordNotFoundError, VersionConflictError } from '../lib/db';
import { publicHandler, staffHandler, type StaffGate } from '../lib/handler';
import { CONFLICT, NOT_FOUND, ok } from '../lib/pflege-api';
import { MaintenanceError } from '../lib/response-utils';
import * as siteRebuild from '../lib/site-rebuild';
import { ValidationError } from '../lib/validation/errors';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function request(
  method = 'POST',
  principal: unknown = PRINCIPAL,
  path = '/api/intern/pflege/test'
): HttpRequest {
  return new HttpRequest({
    url: `http://localhost${path}`,
    method,
    headers:
      principal === null
        ? {}
        : { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') },
    params: { id: '7' },
  });
}

function setup(t: TestContext) {
  const context = new InvocationContext({ functionName: 'handler-test' });
  const log = t.mock.method(context, 'log', () => undefined);
  const error = t.mock.method(context, 'error', () => undefined);
  const rebuild = t.mock.method(siteRebuild, 'requestSiteRebuild', async () => undefined);
  return { context, log, error, rebuild };
}

function header(response: HttpResponseInit, name: string): string | null {
  return new Headers(response.headers).get(name);
}

test('staffHandler refuses requests without a staff login before the handler runs', async (t) => {
  const { context } = setup(t);
  let called = false;
  const handler = staffHandler('test', async () => {
    called = true;
    return ok({});
  });

  assert.equal((await handler(request('GET', null), context)).status, 401);
  assert.equal(
    (await handler(request('GET', { ...PRINCIPAL, userRoles: ['authenticated'] }), context)).status,
    403
  );
  assert.equal(called, false);
});

test('staffHandler maps the shared errors and answers others with a logged 500', async (t) => {
  const { context, error } = setup(t);
  const failing = (thrown: unknown) =>
    staffHandler('test', async () => {
      throw thrown;
    })(request('PATCH'), context);

  const invalid = await failing(new ValidationError({ name: 'Bitte einen Namen eingeben.' }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.jsonBody, {
    error: 'INVALID',
    code: 'INVALID',
    message: 'Die Eingaben sind unvollständig oder ungültig.',
    fields: { name: 'Bitte einen Namen eingeben.' },
  });
  assert.deepEqual((await failing(new VersionConflictError())).jsonBody, CONFLICT.jsonBody);
  assert.deepEqual((await failing(new RecordNotFoundError())).jsonBody, NOT_FOUND.jsonBody);
  // Graph and other errors with an HTTP status
  assert.equal((await failing(Object.assign(new Error('gone'), { statusCode: 404 }))).status, 404);
  assert.equal((await failing(Object.assign(new Error('etag'), { statusCode: 412 }))).status, 409);
  assert.equal((await failing(Object.assign(new Error('busy'), { statusCode: 409 }))).status, 409);

  const maintenance = await failing(new MaintenanceError('Gerade wird gewartet.'));
  assert.equal(maintenance.status, 503);
  assert.deepEqual(maintenance.jsonBody, {
    error: 'MAINTENANCE',
    code: 'MAINTENANCE',
    message: 'Gerade wird gewartet.',
  });
  assert.equal(header(maintenance, 'Cache-Control'), 'no-store');

  assert.equal(error.mock.callCount(), 0);
  const unexpected = new Error('database down');
  const crashed = await failing(unexpected);
  assert.equal(crashed.status, 500);
  assert.deepEqual(crashed.jsonBody, { error: 'Error', message: 'Internal Server Error' });
  assert.equal(error.mock.calls[0].arguments[0], unexpected);
});

test('successful writes are logged with the user and start the build of their area', async (t) => {
  const { context, log, rebuild } = setup(t);
  const handler = staffHandler('faq', async () => ok({}, 201));

  assert.equal((await handler(request('POST'), context)).status, 201);
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments[0]),
    ['[pflege] staff@example.test POST faq 7']
  );
  assert.deepEqual(
    rebuild.mock.calls.map((call) => call.arguments[0]),
    ['faq']
  );
});

test('reads, refused writes, quiet and read-only requests are not logged', async (t) => {
  const { context, log, rebuild } = setup(t);

  await staffHandler('faq', async () => ok([]))(request('GET'), context);
  await staffHandler('faq', async () => ({ status: 400 }))(request('PATCH'), context);
  await staffHandler('faq', async () => {
    throw new ValidationError({ name: 'Fehlt.' });
  })(request('PATCH'), context);
  await staffHandler('faq', async () => ok({}), { readOnly: true })(request('POST'), context);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(rebuild.mock.callCount(), 0);

  // Quiet writes still start the build, only the log line is left out
  await staffHandler('faq', async () => ok({}), { quiet: true })(request('PUT'), context);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(rebuild.mock.callCount(), 1);
});

test('a gate can answer instead of the handler, and its errors are mapped', async (t) => {
  const { context } = setup(t);
  let called = 0;
  const handler = (gate: StaffGate) =>
    staffHandler(
      'test',
      async () => {
        called++;
        return ok({});
      },
      { gate }
    );

  const closed = { status: 403, jsonBody: { code: 'CLOSED' } };
  const refused = await handler({ check: async () => closed })(request('POST'), context);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.jsonBody, { code: 'CLOSED' });
  const stopped = await handler({
    check: async () => {
      throw new MaintenanceError('Wartung.');
    },
  })(request('POST'), context);
  assert.equal(stopped.status, 503);
  assert.equal(called, 0);

  assert.equal(
    (await handler({ check: async () => undefined })(request('POST'), context)).status,
    200
  );
  assert.equal(called, 1);
});

test('a gate runs the handler, e.g. inside a lock, and keeps the log after it', async (t) => {
  const { context, log } = setup(t);
  const order: string[] = [];
  const gate: StaffGate = {
    run: async (work) => {
      order.push('lock');
      const response = await work();
      order.push('unlock');
      return response;
    },
  };
  const handler = staffHandler(
    'test',
    async () => {
      order.push('handler');
      return ok({});
    },
    { gate }
  );

  await handler(request('POST'), context);
  assert.deepEqual(order, ['lock', 'handler', 'unlock']);
  assert.equal(log.mock.callCount(), 1);
});

test('a no-store gate marks every answer after the login, an unexpected error too', async (t) => {
  const { context } = setup(t);
  const gate: StaffGate = { noStore: (request) => request.method !== 'GET' };
  const answer = (method: string, principal: unknown, fail = false) =>
    staffHandler(
      'test',
      async () => {
        if (fail) throw new Error('boom');
        return { status: 200, jsonBody: {} };
      },
      { gate }
    )(request(method, principal), context);

  assert.equal(header(await answer('POST', PRINCIPAL), 'Cache-Control'), 'no-store');
  const crashed = await answer('POST', PRINCIPAL, true);
  assert.equal(crashed.status, 500);
  assert.equal(header(crashed, 'Cache-Control'), 'no-store');
  assert.equal(header(await answer('GET', PRINCIPAL), 'Cache-Control'), null);
  // The login check answers before the gate
  assert.equal(header(await answer('POST', null), 'Cache-Control'), null);
});

test('internal requests report their timings, public ones do not', async (t) => {
  const { context } = setup(t);
  const handler = publicHandler(async () => ({ status: 200 }));
  const staff = staffHandler('test', async () => ok({}));

  assert.match(
    header(await handler(request('GET', null, '/api/intern/test'), context), 'Server-Timing') ?? '',
    /total;dur=/
  );
  assert.equal(
    header(await handler(request('GET', null, '/api/blog'), context), 'Server-Timing'),
    null
  );
  assert.match(header(await staff(request('GET'), context), 'Server-Timing') ?? '', /auth;dur=/);
});

test('publicHandler answers unexpected errors with a 500, with details only on request', async (t) => {
  const { context, error } = setup(t);
  const failing = new Error('upstream down');
  const handler = (exposeErrorDetails?: boolean) =>
    publicHandler(
      async () => {
        throw failing;
      },
      { exposeErrorDetails }
    )(request('GET', null, '/api/blog'), context);

  assert.deepEqual((await handler()).jsonBody, {
    error: 'Error',
    message: 'Internal Server Error',
  });
  assert.deepEqual((await handler(true)).jsonBody, { error: 'Error', message: 'upstream down' });
  assert.equal(error.mock.callCount(), 2);
});
