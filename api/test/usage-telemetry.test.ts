import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { staffHandler } from '../lib/handler';
import { ok } from '../lib/pflege-api';
import * as siteRebuild from '../lib/site-rebuild';
import {
  MODULE_OPENED,
  parseConnectionString,
  pseudonymOf,
  STAFF_ACTION,
  trackStaffEvent,
} from '../lib/usage-telemetry';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'user-1234',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};
const CONNECTION =
  'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/';

function withEnvironment(t: TestContext, values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

interface Envelope {
  iKey: string;
  tags: Record<string, string>;
  data: { baseData: { name: string; properties: Record<string, string> } };
}

/** Records the envelopes sent to Application Insights. */
function captureFetch(t: TestContext, response = new Response('{}')) {
  const sent: { url: string; envelopes: Envelope[] }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, envelopes: JSON.parse(String(init.body)) as Envelope[] });
    return response;
  });
  return sent;
}

test('connection strings yield the key and the track URL of their region', () => {
  assert.deepEqual(parseConnectionString(CONNECTION), {
    instrumentationKey: '00000000-0000-0000-0000-000000000001',
    trackUrl: 'https://westeurope-5.in.applicationinsights.azure.com/v2.1/track',
  });
  assert.deepEqual(
    parseConnectionString('instrumentationkey=abc;IngestionEndpoint=https://x.test'),
    {
      instrumentationKey: 'abc',
      trackUrl: 'https://x.test/v2.1/track',
    }
  );
  assert.equal(
    parseConnectionString('InstrumentationKey=abc')?.trackUrl,
    'https://dc.services.visualstudio.com/v2.1/track'
  );
  assert.equal(parseConnectionString('IngestionEndpoint=https://x.test/'), null);
});

test('without a connection string nothing is sent', async (t) => {
  withEnvironment(t, { USAGE_INSIGHTS_CONNECTION_STRING: undefined });
  const sent = captureFetch(t);
  await trackStaffEvent(MODULE_OPENED, PRINCIPAL, { module: '/leitendenbereich/belege' });
  assert.equal(sent.length, 0);
});

test('an event names the module and a pseudonym, never the account', async (t) => {
  withEnvironment(t, {
    USAGE_INSIGHTS_CONNECTION_STRING: CONNECTION,
    USAGE_PSEUDONYM_SECRET: 'test-secret',
  });
  const sent = captureFetch(t);
  await trackStaffEvent(MODULE_OPENED, PRINCIPAL, { module: '/leitendenbereich/belege' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://westeurope-5.in.applicationinsights.azure.com/v2.1/track');
  const [envelope] = sent[0].envelopes;
  assert.equal(envelope.iKey, '00000000-0000-0000-0000-000000000001');
  assert.equal(envelope.data.baseData.name, MODULE_OPENED);
  assert.deepEqual(envelope.data.baseData.properties, {
    module: '/leitendenbereich/belege',
    environment: 'production',
  });
  assert.equal(envelope.tags['ai.user.id'], pseudonymOf(PRINCIPAL));
  assert.match(envelope.tags['ai.user.id'], /^[0-9a-f]{32}$/);
  const body = JSON.stringify(sent[0].envelopes);
  assert.ok(!body.includes(PRINCIPAL.userId) && !body.includes(PRINCIPAL.userDetails));
});

test('pseudonyms stay the same per person, differ between people and need the secret', (t) => {
  withEnvironment(t, { USAGE_PSEUDONYM_SECRET: 'test-secret' });
  const other = { ...PRINCIPAL, userId: 'user-5678' };
  assert.equal(pseudonymOf(PRINCIPAL), pseudonymOf({ ...PRINCIPAL }));
  assert.notEqual(pseudonymOf(PRINCIPAL), pseudonymOf(other));
  const first = pseudonymOf(PRINCIPAL);

  withEnvironment(t, { USAGE_PSEUDONYM_SECRET: 'another-secret' });
  assert.notEqual(pseudonymOf(PRINCIPAL), first);

  withEnvironment(t, { USAGE_PSEUDONYM_SECRET: undefined });
  assert.equal(pseudonymOf(PRINCIPAL), undefined);
});

test('without the secret events count without a user', async (t) => {
  withEnvironment(t, {
    USAGE_INSIGHTS_CONNECTION_STRING: CONNECTION,
    USAGE_PSEUDONYM_SECRET: undefined,
  });
  const sent = captureFetch(t);
  await trackStaffEvent(MODULE_OPENED, PRINCIPAL, { module: '/leitendenbereich/belege' });
  assert.equal(sent[0].envelopes[0].tags['ai.user.id'], undefined);
});

test('a failed or refused send never fails the caller', async (t) => {
  withEnvironment(t, { USAGE_INSIGHTS_CONNECTION_STRING: CONNECTION });
  const warn = t.mock.method(console, 'warn', () => undefined);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await trackStaffEvent(MODULE_OPENED, PRINCIPAL, { module: '/leitendenbereich/belege' });

  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 400 }));
  await trackStaffEvent(MODULE_OPENED, PRINCIPAL, { module: '/leitendenbereich/belege' });
  assert.equal(warn.mock.callCount(), 2);
});

function staffRequest(method: string): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/test',
    method,
    headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64') },
    params: { id: '7' },
  });
}

test('successful writes of staff endpoints count as an action of their area', async (t) => {
  withEnvironment(t, { USAGE_INSIGHTS_CONNECTION_STRING: CONNECTION });
  t.mock.method(siteRebuild, 'requestSiteRebuild', async () => undefined);
  const context = new InvocationContext({ functionName: 'usage-test' });
  t.mock.method(context, 'log', () => undefined);
  const sent = captureFetch(t);

  await staffHandler('belege', async () => ok({}))(staffRequest('PUT'), context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].envelopes[0].data.baseData.name, STAFF_ACTION);
  assert.deepEqual(sent[0].envelopes[0].data.baseData.properties, {
    area: 'belege',
    method: 'PUT',
    environment: 'production',
  });

  // Reads, autosaves, read-only POSTs and refused writes are no actions
  await staffHandler('belege', async () => ok({}))(staffRequest('GET'), context);
  await staffHandler('belege', async () => ok({}), { quiet: true })(staffRequest('PUT'), context);
  await staffHandler('belege', async () => ok({}), { readOnly: true })(
    staffRequest('POST'),
    context
  );
  await staffHandler('belege', async () => ({ status: 409 }))(staffRequest('PUT'), context);
  assert.equal(sent.length, 1);
});
