import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as env from '../lib/environment';
import { GetInternAktionBeitraegeEndpoint } from '../endpoints/intern-aktion-beitraege';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function request(id = 'evt_1', query = '', principal: object | null = PRINCIPAL): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/aktionen/${id}/beitraege${query}`,
    method: 'GET',
    params: { id },
    headers: principal
      ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
      : {},
  });
}

function mockPlaywright(t: TestContext, status: number, body: unknown) {
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  return t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );
}

const fee = {
  id: 'fee_1',
  reference: 'AB12345',
  description: 'Teilnehmendenbeitrag',
  costUnit: { id: 'cun_1', name: 'Stammeslager 2026', color: '#eab308' },
  category: { id: 'cat_1', name: 'Teilnehmerbeiträge' },
  date: '2026-03-21',
  amount: 90,
  dueAmount: 90,
  paidAmount: 40.5,
  openAmount: 49.5,
  status: 'partial',
};

/** As the Playwright API answers `GET /campflow/aktionen/{eventId}/beitraege`. */
const ANSWER = {
  eventId: 'evt_1',
  loadedAt: '2026-10-19T12:00:00.000Z',
  persons: [
    { id: 'per_1', name: 'Kim Beispiel', lifecycle: 'confirmed', fees: [fee] },
    { id: 'per_2', name: 'Alex Muster', lifecycle: 'triage', fees: [] },
  ],
};

test('the Beiträge of an Aktion need a login and a valid ID', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  assert.equal((await GetInternAktionBeitraegeEndpoint(request('evt_1', '', null))).status, 401);
  assert.equal((await GetInternAktionBeitraegeEndpoint(request('evt_1/../x'))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test('the Beiträge of an Aktion come per person and in cents', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternAktionBeitraegeEndpoint(request());
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers, { 'Cache-Control': 'no-store' });
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.pathname, '/campflow/aktionen/evt_1/beitraege');
  assert.equal(url.searchParams.get('refresh'), null);
  assert.deepEqual(response.jsonBody, {
    loadedAt: '2026-10-19T12:00:00.000Z',
    persons: {
      per_1: [
        {
          id: 'fee_1',
          reference: 'AB12345',
          description: 'Teilnehmendenbeitrag',
          amountCent: 9000,
          dueCent: 9000,
          paidCent: 4050,
          openCent: 4950,
          status: 'partial',
        },
      ],
      per_2: [],
    },
  });
});

test('refresh=true reads the Aktion from CampFlow again', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  assert.equal(
    (await GetInternAktionBeitraegeEndpoint(request('evt_1', '?refresh=true'))).status,
    200
  );
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('refresh'), 'true');
});

test('a broken answer is an error, not a wrong payment status', async (t) => {
  for (const persons of [
    [{ ...ANSWER.persons[0], fees: [{ ...fee, status: 'maybe' }] }],
    [{ ...ANSWER.persons[0], id: '__proto__' }],
    [{ ...ANSWER.persons[0], fees: null }],
  ]) {
    mockPlaywright(t, 200, { ...ANSWER, persons });
    const response = await GetInternAktionBeitraegeEndpoint(request());
    assert.equal(response.status, 502);
    assert.equal((response.jsonBody as { code: string }).code, 'BEITRAEGE_UNAVAILABLE');
    t.mock.restoreAll();
  }
});

test('an Aktion CampFlow does not know is a 404, other failures say what to do next', async (t) => {
  mockPlaywright(t, 404, { error: 'Die Aktion gibt es nicht' });
  assert.equal((await GetInternAktionBeitraegeEndpoint(request())).status, 404);
  t.mock.restoreAll();
  mockPlaywright(t, 504, { error: 'Job exceeded' });
  const response = await GetInternAktionBeitraegeEndpoint(request());
  assert.equal(response.status, 502);
  assert.match(JSON.stringify(response.jsonBody), /admin@stamm-phoenix\.de/);
});
