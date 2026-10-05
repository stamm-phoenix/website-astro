import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as bookings from '../lib/nikolaus-bookings';
import * as day from '../lib/nikolaus-day';
import * as travel from '../lib/travel-times';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { getDispoRows, getDispoVisitVersion } from '../lib/nikolaus-dispo-list';
import { listNikolausStates } from '../lib/nikolaus-state';
import { getNikolausRetentionSchedule } from '../lib/nikolaus-retention-schedule';
import { getVisitedTime } from '../lib/nikolaus-visit-time';
import {
  GetInternNikolausFahrtEndpoint,
  NikolausFahrtVisit,
} from '../endpoints/intern-nikolaus-fahrt';
import { GetInternNikolausDispoEndpoint } from '../endpoints/intern-nikolaus-dispo';
import { GetNikolausProgressEndpoint } from '../endpoints/nikolaus-manage-progress';
import { setupSharedState } from './fixtures/shared-state';

const DATE = '2026-12-05';
const TOKEN = 'test-dated-visit-token-long-enough';

function booking(): NikolausBooking {
  return {
    id: '1',
    etag: '"1,1"',
    familyName: 'Testfamilie',
    email: 'family@example.test',
    phone: '0123456789',
    street: 'Teststraße 1',
    postalCode: '83620',
    city: 'Testort',
    addressNotes: '',
    childrenCount: 2,
    withKrampus: false,
    hidingPlace: 'Tür',
    notes: '',
    slotKey: `${DATE}T17:00`,
    status: 'Bestaetigt',
    geo: { Breitengrad: '', Laengengrad: '', GeoGenauigkeit: '' },
    internalTags: [],
    rejectedStufen: [],
    tokenHash: bookings.hashToken(TOKEN),
    reservedUntil: undefined,
    confirmedAt: undefined,
    changedAt: undefined,
    linkSentAt: undefined,
  };
}

function plannedRow(visitedAt = '') {
  return {
    id: `dispo:${DATE}:1`,
    etag: '',
    bookingId: '1',
    date: DATE,
    team: 'A',
    order: 1,
    slotKey: `${DATE}T17:00`,
    plannedArrival: '17:00',
    fixed: false,
    visited: visitedAt !== '',
    visitedAt,
  };
}

function staffRequest(
  method: 'GET' | 'POST',
  visited = true,
  version = getDispoVisitVersion(plannedRow())
): HttpRequest {
  return new HttpRequest({
    method,
    url: `https://example.test/api/intern/nikolaus/fahrt?date=${DATE}`,
    headers: {
      'x-ms-client-principal': Buffer.from(
        JSON.stringify({
          identityProvider: 'aad',
          userId: 'staff-test',
          userDetails: 'staff@example.test',
          userRoles: ['authenticated'],
        })
      ).toString('base64'),
    },
    ...(method === 'POST'
      ? {
          body: {
            string: JSON.stringify({
              bookingId: '1',
              visited,
              version,
              operationId: randomUUID(),
              slotKey: `${DATE}T17:00`,
            }),
          },
        }
      : {}),
  });
}

test('client time formatting accepts legacy clocks and dated completions in Berlin winter and summer', () => {
  assert.equal(getVisitedTime('17:12'), '17:12');
  assert.equal(getVisitedTime('2026-12-07T20:15:00.000Z'), '21:15');
  assert.equal(getVisitedTime('2026-07-07T20:15:00.000Z'), '22:15');
  assert.equal(getVisitedTime('2026-12-07T21:15:00+01:00'), '21:15');
  for (const invalid of ['', '25:90', 'invalid', '2026-12-07T21:15:00'])
    assert.equal(getVisitedTime(invalid), '');
});

test('late server check-off preserves its actual date for retention while staff DTOs keep HH:mm', async (t) => {
  const actual = new Date('2026-12-07T20:15:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: actual });
  setupSharedState(t).seed(`planning:dispo:${DATE}`, { schema: 1, rows: [plannedRow()] });
  t.mock.method(bookings, 'getAllBookings', async () => [booking()]);
  t.mock.method(day, 'getTeamMembers', async () => ({}));
  t.mock.method(travel, 'getTravelMatrix', async () => ({
    minutes: [
      [0, 0],
      [0, 0],
    ],
    source: 'estimate' as const,
  }));
  const context = new InvocationContext();
  t.mock.method(context, 'log', () => undefined);
  const response = await NikolausFahrtVisit(staffRequest('POST'), context);
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { visitedAt: string }).visitedAt, '21:15');
  assert.equal((await getDispoRows(DATE))[0].visitedAt, actual.toISOString());
  const states = await listNikolausStates('planning:dispo:');
  const schedule = getNikolausRetentionSchedule(
    {
      booking: [{ id: '1', eTag: '"1,1"', fields: { SlotKey: `${DATE}T17:00` } }],
      dispo: [],
      helper: [],
      einteilung: [],
      states,
    },
    new Date('2027-01-07T00:00:00Z')
  );
  assert.equal(schedule.policies[0].lastVisit, '2026-12-07');
  assert.equal(schedule.policies[0].deleteOn, '2027-01-07');
  const fahrt = await GetInternNikolausFahrtEndpoint(staffRequest('GET'));
  assert.equal(
    (fahrt.jsonBody as { routes: Record<string, { visitedAt: string }[]> }).routes.A[0].visitedAt,
    '21:15'
  );
  const dispo = await GetInternNikolausDispoEndpoint(staffRequest('GET'));
  assert.equal((dispo.jsonBody as { rows: { visitedAt: string }[] }).rows[0].visitedAt, '21:15');
  await NikolausFahrtVisit(
    staffRequest('POST', false, getDispoVisitVersion((await getDispoRows(DATE))[0])),
    context
  );
  assert.equal((await getDispoRows(DATE))[0].visitedAt, '');
});

test('dated same-day visits remain usable in the public route progress calculation', async (t) => {
  const actual = new Date('2026-12-05T16:15:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: actual });
  setupSharedState(t).seed(`planning:dispo:${DATE}`, {
    schema: 1,
    rows: [plannedRow(actual.toISOString())],
  });
  t.mock.method(bookings, 'getAllBookings', async () => [booking()]);
  const response = await GetNikolausProgressEndpoint(
    new HttpRequest({
      method: 'POST',
      url: 'https://example.test/api/nikolaus/manage/progress',
      body: { string: JSON.stringify({ token: TOKEN }) },
    })
  );
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { phase: string }).phase, 'today');
  assert.equal((response.jsonBody as { delayMinutes: number }).delayMinutes, 5);
  assert.equal((response.jsonBody as { visited: boolean }).visited, true);
});

test('a booking moved within the day rejects an offline mark for the old slot', async (t) => {
  setupSharedState(t).seed(`planning:dispo:${DATE}`, { schema: 1, rows: [plannedRow()] });
  t.mock.method(bookings, 'getAllBookings', async () => [
    { ...booking(), slotKey: `${DATE}T18:00` },
  ]);
  const context = new InvocationContext();
  t.mock.method(context, 'log', () => undefined);
  const response = await NikolausFahrtVisit(staffRequest('POST'), context);
  assert.equal(response.status, 409);
  assert.equal((await getDispoRows(DATE))[0].visited, false);
});
