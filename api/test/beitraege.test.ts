import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as env from '../lib/environment';
import { GetInternBeitraegeEndpoint } from '../endpoints/intern-beitraege';
import { GetInternBeitraegeMeineEndpoint } from '../endpoints/intern-beitraege-meine';
import { offeneBeitraege, readBeitraege } from '../lib/beitraege';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function request(query = '', principal: object | null = PRINCIPAL): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/beitraege${query}`,
    method: 'GET',
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

/** As the Playwright API answers `GET /campflow/beitraege`. */
const ANSWER = {
  loadedAt: '2026-10-19T12:00:00.000Z',
  batches: [
    {
      id: 'bat_1',
      name: 'Stammeslager 2026',
      type: 'event',
      eventId: 'evt_1',
      feeCount: 2,
      settledCount: 1,
      totalAmount: 175.5,
      openAmount: 75.5,
      refundAmount: 0,
    },
  ],
  fees: [
    {
      id: 'fee_1',
      reference: 'AB12345',
      description: 'Teilnehmendenbeitrag',
      batch: { id: 'bat_1', name: 'Stammeslager 2026' },
      costUnit: { id: 'cun_1', name: 'Stammeslager 2026', color: '#eab308' },
      category: { id: 'cat_1', name: 'Teilnehmerbeiträge' },
      payer: 'Kim Beispiel',
      payerId: 'per_1',
      paymentMethod: 'bank_transfer',
      date: '2026-03-21',
      amount: 75.5,
      dueAmount: 75.5,
      paidAmount: 0,
      openAmount: 75.5,
      status: 'unpaid',
      paidAt: null,
    },
  ],
};

test('Beiträge need a login', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternBeitraegeEndpoint(request('', null));
  assert.equal(response.status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Beiträge come from the Playwright API in cents', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternBeitraegeEndpoint(request());
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers, { 'Cache-Control': 'no-store' });
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.pathname, '/campflow/beitraege');
  assert.equal(url.searchParams.get('refresh'), null);
  const init = fetch.mock.calls[0].arguments[1] as RequestInit;
  assert.equal(init.method, undefined);
  assert.deepEqual(response.jsonBody, {
    loadedAt: '2026-10-19T12:00:00.000Z',
    batches: [
      {
        id: 'bat_1',
        name: 'Stammeslager 2026',
        type: 'event',
        eventId: 'evt_1',
        feeCount: 2,
        settledCount: 1,
        totalCent: 17550,
        openCent: 7550,
        refundCent: 0,
      },
    ],
    fees: [
      {
        id: 'fee_1',
        reference: 'AB12345',
        description: 'Teilnehmendenbeitrag',
        batchId: 'bat_1',
        costUnit: { id: 'cun_1', name: 'Stammeslager 2026' },
        category: 'Teilnehmerbeiträge',
        payer: 'Kim Beispiel',
        payerId: 'per_1',
        paymentMethod: 'bank_transfer',
        date: '2026-03-21',
        amountCent: 7550,
        dueCent: 7550,
        paidCent: 0,
        openCent: 7550,
        status: 'unpaid',
        paidAt: null,
      },
    ],
  });
});

test('refresh=true reads CampFlow again', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  assert.equal((await GetInternBeitraegeEndpoint(request('?refresh=true'))).status, 200);
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('refresh'), 'true');
});

test('an unknown status or a broken answer is an error, not a wrong list', async (t) => {
  const broken = { ...ANSWER, fees: [{ ...ANSWER.fees[0], status: 'maybe' }] };
  mockPlaywright(t, 200, broken);
  const response = await GetInternBeitraegeEndpoint(request());
  assert.equal(response.status, 502);
  assert.equal((response.jsonBody as { code: string }).code, 'BEITRAEGE_UNAVAILABLE');
});

test('a failing Playwright API says what to do next', async (t) => {
  mockPlaywright(t, 504, { error: 'Job exceeded' });
  const response = await GetInternBeitraegeEndpoint(request());
  assert.equal(response.status, 502);
  assert.match(JSON.stringify(response.jsonBody), /admin@stamm-phoenix\.de/);
});

test('the start page gets only the Beiträge with something left to do', () => {
  const fee = (id: string, status: string, batch: string) => ({
    ...ANSWER.fees[0],
    id,
    status,
    batch: { id: batch, name: batch },
  });
  const beitraege = readBeitraege({
    ...ANSWER,
    batches: [ANSWER.batches[0], { ...ANSWER.batches[0], id: 'bat_2', eventId: null }],
    fees: [
      fee('fee_unpaid', 'unpaid', 'bat_1'),
      fee('fee_partial', 'partial', 'bat_1'),
      fee('fee_refund', 'refund', 'bat_1'),
      fee('fee_paid', 'paid', 'bat_2'),
      fee('fee_cancelled', 'cancelled', 'bat_2'),
    ],
  });
  const offen = offeneBeitraege(beitraege);
  assert.deepEqual(
    offen.fees.map((f) => f.id),
    ['fee_unpaid', 'fee_partial', 'fee_refund']
  );
  assert.deepEqual(
    offen.batches.map((b) => b.id),
    ['bat_1']
  );
});

dbTest('own Beiträge without a link leave the names to decide', async (t) => {
  mockPlaywright(t, 200, ANSWER);
  const response = await GetInternBeitraegeMeineEndpoint(request());
  assert.equal(response.status, 200);
  const body = response.jsonBody as { fees: { id: string }[]; ich: object | null };
  assert.deepEqual(
    body.fees.map((f) => f.id),
    ['fee_1']
  );
  assert.equal(body.ich, null);
});

test('own Beiträge need a login and say when CampFlow fails', async (t) => {
  mockPlaywright(t, 504, { error: 'Job exceeded' });
  assert.equal((await GetInternBeitraegeMeineEndpoint(request('', null))).status, 401);
  const response = await GetInternBeitraegeMeineEndpoint(request());
  assert.equal(response.status, 502);
  assert.equal((response.jsonBody as { code: string }).code, 'BEITRAEGE_UNAVAILABLE');
  assert.match(JSON.stringify(response.jsonBody), /in ein paar Minuten/);
});

test('own Beiträge without a CampFlow login point to the admin', async (t) => {
  mockPlaywright(t, 503, { error: 'Not configured' });
  const response = await GetInternBeitraegeMeineEndpoint(request());
  assert.equal(response.status, 502);
  assert.match(JSON.stringify(response.jsonBody), /kein CampFlow-Zugang.*admin@stamm-phoenix\.de/);
});

test('after a slow Playwright API the names decide instead of waiting longer', async (t) => {
  const now = Date.now();
  // The Beiträge took the whole budget
  const clock = t.mock.method(Date, 'now', () => now);
  t.mock.method(env, 'getEnvironment', () => 'test-key');
  t.mock.method(globalThis, 'fetch', async () => {
    clock.mock.mockImplementation(() => now + 41_000);
    return new Response(JSON.stringify(ANSWER), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const response = await GetInternBeitraegeMeineEndpoint(request());
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { ich: object | null }).ich, null);
});
