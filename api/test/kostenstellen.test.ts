import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as env from '../lib/environment';
import { GetInternKostenstellenEndpoint } from '../endpoints/intern-kostenstellen';

const KASSE = {
  identityProvider: 'aad',
  userId: 'test-kasse',
  userDetails: 'kasse@example.test',
  userRoles: ['authenticated', 'team_leitende', 'team_kasse'],
};

function request(query = '', principal: object | null = KASSE): HttpRequest {
  return new HttpRequest({
    url: `https://example.test/api/intern/kostenstellen${query}`,
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

const sums = (income: number, expenses: number, bookings: number) => ({
  income,
  expenses,
  balance: income + expenses,
  openIncome: 0,
  openExpenses: 0,
  bookings,
});

/** As the Playwright API answers `GET /campflow/kostenstellen/summen`. */
const ANSWER = {
  exportedAt: '2026-10-26T09:00:00.000Z',
  costUnits: [
    {
      id: 'cun_alt',
      name: 'Lager 2019',
      color: '#0d9488',
      archived: true,
      ...sums(0, 0, 0),
      categories: [],
    },
    {
      id: 'cun_lager',
      name: 'Stammeslager 2026',
      color: '#eab308',
      archived: false,
      ...sums(90, -120.8, 4),
      openIncome: 10,
      openExpenses: -0.1,
      categories: [
        {
          id: 'cat_fahrt',
          name: 'Fahrtkosten',
          sphere: 'purpose',
          ...sums(0, -120.8, 3),
          openExpenses: -0.1,
        },
        { id: null, name: '', sphere: null, ...sums(90, 0, 1), openIncome: 10 },
      ],
    },
    {
      id: 'cun_allgemein',
      name: 'Allgemein',
      color: 'red; background: url(x)',
      archived: false,
      ...sums(50, 0, 1),
      categories: [{ id: 'cat_spenden', name: 'Spenden', sphere: 'unbekannt', ...sums(50, 0, 1) }],
    },
  ],
};

test('Kostenstellen need a login', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternKostenstellenEndpoint(request('', null));
  assert.equal(response.status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Kostenstellen are only for the teams Kasse and Vorstand', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const leitende = { ...KASSE, userRoles: ['authenticated', 'team_leitende'] };
  const response = await GetInternKostenstellenEndpoint(request('', leitende));
  assert.equal(response.status, 403);
  assert.equal(fetch.mock.callCount(), 0);

  const vorstand = { ...KASSE, userRoles: ['authenticated', 'team_leitende', 'team_vorstand'] };
  assert.equal((await GetInternKostenstellenEndpoint(request('', vorstand))).status, 200);
  // The Leitendenbereich itself still needs the team Leitende
  const nurVorstand = { ...KASSE, userRoles: ['authenticated', 'team_vorstand'] };
  assert.equal((await GetInternKostenstellenEndpoint(request('', nurVorstand))).status, 403);
});

test('Kostenstellen come from the Playwright API in cents, open ones first', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternKostenstellenEndpoint(request());
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers, { 'Cache-Control': 'no-store' });
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.pathname, '/campflow/kostenstellen/summen');
  assert.equal(url.searchParams.get('refresh'), null);
  const zero = {
    incomeCent: 0,
    expensesCent: 0,
    balanceCent: 0,
    openIncomeCent: 0,
    openExpensesCent: 0,
    bookings: 0,
  };
  assert.deepEqual(response.jsonBody, {
    loadedAt: '2026-10-26T09:00:00.000Z',
    costUnits: [
      {
        id: 'cun_allgemein',
        name: 'Allgemein',
        color: null,
        archived: false,
        ...zero,
        incomeCent: 5000,
        balanceCent: 5000,
        bookings: 1,
        categories: [
          {
            id: 'cat_spenden',
            name: 'Spenden',
            sphere: null,
            ...zero,
            incomeCent: 5000,
            balanceCent: 5000,
            bookings: 1,
          },
        ],
      },
      {
        id: 'cun_lager',
        name: 'Stammeslager 2026',
        color: '#eab308',
        archived: false,
        incomeCent: 9000,
        expensesCent: -12080,
        balanceCent: -3080,
        openIncomeCent: 1000,
        openExpensesCent: -10,
        bookings: 4,
        categories: [
          {
            id: 'cat_fahrt',
            name: 'Fahrtkosten',
            sphere: 'purpose',
            ...zero,
            expensesCent: -12080,
            balanceCent: -12080,
            openExpensesCent: -10,
            bookings: 3,
          },
          {
            id: null,
            name: '',
            sphere: null,
            ...zero,
            incomeCent: 9000,
            balanceCent: 9000,
            openIncomeCent: 1000,
            bookings: 1,
          },
        ],
      },
      {
        id: 'cun_alt',
        name: 'Lager 2019',
        color: '#0d9488',
        archived: true,
        ...zero,
        categories: [],
      },
    ],
  });
});

test('Kostenstellen are exported again on request', async (t) => {
  const fetch = mockPlaywright(t, 200, ANSWER);
  const response = await GetInternKostenstellenEndpoint(request('?refresh=true'));
  assert.equal(response.status, 200);
  const url = new URL(String(fetch.mock.calls[0].arguments[0]));
  assert.equal(url.searchParams.get('refresh'), 'true');
});

test('Kostenstellen answer 502 with a message when CampFlow fails or answers nonsense', async (t) => {
  mockPlaywright(t, 502, { error: 'Export abgebrochen' });
  const failed = await GetInternKostenstellenEndpoint(request());
  assert.equal(failed.status, 502);
  assert.match(JSON.stringify(failed.jsonBody), /KOSTENSTELLEN_UNAVAILABLE/);

  t.mock.restoreAll();
  mockPlaywright(t, 200, { exportedAt: 'gestern', costUnits: [] });
  assert.equal((await GetInternKostenstellenEndpoint(request())).status, 502);

  t.mock.restoreAll();
  mockPlaywright(t, 503, { error: 'nicht konfiguriert' });
  const unconfigured = await GetInternKostenstellenEndpoint(request());
  assert.equal(unconfigured.status, 502);
  assert.match(JSON.stringify(unconfigured.jsonBody), /kein CampFlow-Zugang/);
});
