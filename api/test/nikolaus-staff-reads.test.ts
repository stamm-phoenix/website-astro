import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import { GetInternNikolausBookingsEndpoint } from '../endpoints/intern-nikolaus-bookings';
import { GetInternNikolausDispoEndpoint } from '../endpoints/intern-nikolaus-dispo';
import { GetInternNikolausFahrtEndpoint } from '../endpoints/intern-nikolaus-fahrt';
import {
  GetInternNikolausEinteilungEndpoint,
  GetInternNikolausHelfendeEndpoint,
} from '../endpoints/intern-nikolaus-helfende';
import { getDb } from '../lib/db';
import * as bookingsModule from '../lib/nikolaus-bookings';
import type { NikolausSettings } from '../lib/nikolaus-config';
import * as dayModule from '../lib/nikolaus-day';
import * as dispoModule from '../lib/nikolaus-dispo-list';
import * as einteilungModule from '../lib/nikolaus-einteilung-list';
import * as helpersModule from '../lib/nikolaus-helfende-list';
import * as settingsModule from '../lib/nikolaus-settings';
import * as travelModule from '../lib/travel-times';
import { NIKOLAUS_STAFF_INACTIVE } from '../lib/nikolaus-staff';
import { dbTest, recordQueries } from './fixtures/database';
import { insertBooking, insertDispo, insertHelper } from './fixtures/nikolaus-data';
import { TEST_SETTINGS } from './fixtures/nikolaus-settings';

const DATE = '2026-12-05';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function request(path: string): HttpRequest {
  return new HttpRequest({
    url: `http://localhost/api/intern/nikolaus/${path}`,
    method: 'GET',
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Rejects if `promise` does not settle within the time, instead of hanging the test. */
async function within<T>(promise: Promise<T>, what: string, ms = 2000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Answers OpenRouteService matrix requests with 5 minutes per trip and counts them. */
function mockRouting(t: TestContext): { calls: () => number; called: Promise<void> } {
  const previous = process.env.OPENROUTESERVICE_API_KEY;
  process.env.OPENROUTESERVICE_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.OPENROUTESERVICE_API_KEY;
    else process.env.OPENROUTESERVICE_API_KEY = previous;
  });
  const called = deferred<void>();
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    called.resolve();
    const { locations } = JSON.parse(String(init.body)) as { locations: unknown[] };
    return Response.json({ durations: locations.map(() => locations.map(() => 300)) });
  });
  return { calls: () => fetch.mock.callCount(), called: called.promise };
}

type Endpoint = (request: HttpRequest) => Promise<HttpResponseInit>;

/** The GET of every Nikolaus page with the reads it needs. */
const PAGES: [string, Endpoint, string, [object, string][]][] = [
  [
    'Buchungen',
    GetInternNikolausBookingsEndpoint,
    'bookings',
    [[bookingsModule, 'getAllBookings']],
  ],
  [
    'Dispo',
    GetInternNikolausDispoEndpoint,
    `dispo?date=${DATE}`,
    [
      [bookingsModule, 'getAllBookings'],
      [dispoModule, 'getDispoRows'],
      [dayModule, 'getTeamMembers'],
    ],
  ],
  [
    'Fahrt',
    GetInternNikolausFahrtEndpoint,
    `fahrt?date=${DATE}`,
    [
      [bookingsModule, 'getAllBookings'],
      [dispoModule, 'getDispoRows'],
      [dayModule, 'getTeamMembers'],
    ],
  ],
  [
    'Helfende',
    GetInternNikolausHelfendeEndpoint,
    'helfende',
    [
      [helpersModule, 'getHelpers'],
      [bookingsModule, 'getAllBookingTags'],
    ],
  ],
  [
    'Einteilung',
    GetInternNikolausEinteilungEndpoint,
    'einteilung',
    [
      [helpersModule, 'getHelpers'],
      [bookingsModule, 'getAllBookings'],
      [einteilungModule, 'getEinteilungRows'],
      [dispoModule, 'getAllDispoRows'],
    ],
  ],
];

dbTest(
  'the Nikolaus pages start all their reads with the settings and answer nothing while switched off',
  async (t) => {
    const { booking } = await insertBooking(`${DATE}T17:00`);
    await insertDispo(booking.id, DATE);
    mockRouting(t);
    const travel = t.mock.method(travelModule, 'getTravelMatrix');

    for (const [page, endpoint, path, reads] of PAGES) {
      for (const staffActive of [false, true]) {
        const settings = deferred<NikolausSettings>();
        const gate = t.mock.method(settingsModule, 'getNikolausSettings', () => settings.promise);
        const spies = reads.map(([module, name]) => {
          const spy = t.mock.method(module as Record<string, () => Promise<unknown>>, name);
          return { name, spy };
        });
        const routed = travel.mock.callCount();

        const response = endpoint(request(path));
        // Give every read that does not wait for the settings the chance to start
        await new Promise((resolve) => setImmediate(resolve));
        for (const { name, spy } of spies) {
          assert.equal(spy.mock.callCount(), 1, `${page}: ${name} starts with the settings`);
        }
        settings.resolve(structuredClone({ ...TEST_SETTINGS, staffActive }));
        const answer = await response;

        if (staffActive) {
          assert.equal(answer.status, 200, page);
        } else {
          assert.deepEqual(answer, NIKOLAUS_STAFF_INACTIVE, page);
          // Let the dropped reads finish: no family address goes to the routing service
          await Promise.allSettled(spies.map(({ spy }) => spy.mock.calls[0].result));
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(travel.mock.callCount(), routed, page);
        }
        gate.mock.restore();
        for (const { spy } of spies) spy.mock.restore();
      }
    }
    assert.equal(travel.mock.callCount(), 1, 'the Dispo asks for the driving times');
  }
);

dbTest('the Dispo asks for the driving times while its other reads still load', async (t) => {
  const { booking } = await insertBooking(`${DATE}T17:00`);
  await insertBooking(`${DATE}T17:30`, { latitude: 47.86 });
  await insertDispo(booking.id, DATE);
  const routing = mockRouting(t);
  const rows = deferred<void>();
  const original = dispoModule.getDispoRows;
  t.mock.method(dispoModule, 'getDispoRows', async (date: string) => {
    await rows.promise;
    return original(date);
  });

  const response = GetInternNikolausDispoEndpoint(request(`dispo?date=${DATE}`));
  await within(routing.called, 'the request to the routing service');
  rows.resolve();
  const answer = await response;

  assert.equal(answer.status, 200);
  const body = answer.jsonBody as { travelSource: string; travel: number[][]; stops: unknown[] };
  assert.equal(body.travelSource, 'route');
  assert.equal(body.stops.length, 2);
  // Five minutes of driving and two to park, between all three points
  assert.deepEqual(body.travel, [
    [0, 7, 7],
    [7, 0, 7],
    [7, 7, 0],
  ]);
});

dbTest('the Helfende page reads only the tags of the bookings', async (t) => {
  await insertHelper({ name: 'Anna', positiveTags: ['Hund'] });
  await insertBooking(`${DATE}T17:00`, { internal_tags: '["Katze","hund"]' });
  await insertBooking(`${DATE}T17:30`, { status: 'Storniert', internal_tags: '["Allergie"]' });
  const all = t.mock.method(bookingsModule, 'getAllBookings');
  const queries = recordQueries(t);

  const response = await GetInternNikolausHelfendeEndpoint(request('helfende'));

  assert.equal(response.status, 200);
  // First spelling wins, the helpers' tags first
  assert.deepEqual((response.jsonBody as { tags: string[] }).tags, ['Allergie', 'Hund', 'Katze']);
  assert.equal(all.mock.callCount(), 0);
  const bookingReads = queries.filter((query) => query.sql.includes('"nikolaus"."booking"'));
  assert.equal(bookingReads.length, 1);
  assert.deepEqual(Object.keys(bookingReads[0].rows[0] as object), ['internal_tags']);
});

dbTest('the Buchungen page reads the bookings once and counts only blocking ones', async (t) => {
  const now = Date.now();
  await insertBooking(`${DATE}T17:00`);
  await insertBooking(`${DATE}T17:00`, {
    status: 'Ausstehend',
    confirmed_at: null,
    reserved_until: new Date(now + 60 * 60_000),
  });
  // Expired longer ago than the grace period: the place is free again
  await insertBooking(`${DATE}T17:00`, {
    status: 'Ausstehend',
    confirmed_at: null,
    reserved_until: new Date(now - 10 * 60_000),
  });
  await insertBooking(`${DATE}T17:30`, { status: 'Storniert' });
  await insertBooking(`${DATE}T17:30`, { status: 'Abgelaufen', confirmed_at: null });
  // A day removed in the Steuerung has no slots to count
  await insertBooking('2026-12-24T17:00');
  const queries = recordQueries(t);

  const response = await GetInternNikolausBookingsEndpoint(request('bookings'));

  assert.equal(response.status, 200);
  const body = response.jsonBody as {
    slots: { key: string; taken: number }[];
    bookings: unknown[];
  };
  assert.equal(body.bookings.length, 6);
  const taken = Object.fromEntries(body.slots.map((slot) => [slot.key, slot.taken]));
  assert.equal(taken[`${DATE}T17:00`], 2);
  assert.equal(taken[`${DATE}T17:30`], 0);
  assert.equal(taken['2026-12-24T17:00'], undefined);
  assert.equal(
    queries.filter((query) => query.sql.includes('"nikolaus"."booking"')).length,
    1,
    'one read of the bookings'
  );
});

dbTest('the team members of a day are read for that day only', async (t) => {
  const anna = await insertHelper({ name: ' Anna ', negativeTags: ['Hund'] });
  const ben = await insertHelper({ name: 'Ben', positiveTags: ['Kinder'] });
  const cleo = await insertHelper({ name: 'Cleo' });
  const dora = await insertHelper({ name: 'Dora' });
  await getDb()
    .insertInto('nikolaus.assignment')
    .values([
      { helper_id: Number(anna), date: DATE, team: 'A', role: 'Krampus', fixed: false },
      { helper_id: Number(ben), date: DATE, team: 'A', role: 'Nikolaus', fixed: false },
      { helper_id: Number(cleo), date: DATE, team: 'Küche', role: 'Küche', fixed: false },
      { helper_id: Number(dora), date: '2026-12-06', team: 'A', role: 'Nikolaus', fixed: false },
    ])
    .execute();
  const queries = recordQueries(t);

  const members = await dayModule.getTeamMembers(DATE);

  assert.deepEqual(members, {
    A: [
      { personId: ben, name: 'Ben', role: 'Nikolaus', negativeTags: [], positiveTags: ['Kinder'] },
      { personId: anna, name: 'Anna', role: 'Krampus', negativeTags: ['Hund'], positiveTags: [] },
    ],
  });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].rows.length, 2, 'neither the kitchen nor other days are loaded');
});

dbTest(
  'Dispo and Fahrt answer an impossible date with „not found“, not with an error',
  async () => {
    for (const date of ['2026-99-99', '2026-02-30', '0000-01-01']) {
      for (const [name, endpoint] of [
        ['dispo', GetInternNikolausDispoEndpoint],
        ['fahrt', GetInternNikolausFahrtEndpoint],
      ] as const) {
        const response = await endpoint(request(`${name}?date=${date}`));
        assert.equal(response.status, 404, `${name} ${date}`);
      }
    }
  }
);
