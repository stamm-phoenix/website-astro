import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as day from '../lib/nikolaus-day';
import * as travel from '../lib/travel-times';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getDispoRows, getDispoVisitVersion } from '../lib/nikolaus-dispo-list';
import { loadRetentionSources } from '../lib/nikolaus-retention';
import { getNikolausRetentionSchedule } from '../lib/nikolaus-retention-schedule';
import { getVisitedTime } from '../lib/nikolaus-visit-time';
import { getDb } from '../lib/db';
import {
  GetInternNikolausFahrtEndpoint,
  NikolausFahrtVisit,
} from '../endpoints/intern-nikolaus-fahrt';
import { GetInternNikolausDispoEndpoint } from '../endpoints/intern-nikolaus-dispo';
import { GetNikolausProgressEndpoint } from '../endpoints/nikolaus-manage-progress';
import { setupSharedState } from './fixtures/shared-state';
import { dbTest } from './fixtures/database';
import { insertBooking, insertDispo } from './fixtures/nikolaus-data';

const DATE = '2026-12-05';

async function plannedRow(): Promise<DispoRow> {
  return (await getDispoRows(DATE))[0];
}

function staffRequest(
  method: 'GET' | 'POST',
  bookingId = '',
  visited = true,
  version = ''
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
              bookingId,
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

dbTest(
  'late server check-off preserves its actual date for retention while staff DTOs keep HH:mm',
  async (t) => {
    setupSharedState(t);
    const { booking } = await insertBooking(`${DATE}T17:00`);
    await insertDispo(booking.id, DATE);
    const actual = new Date('2026-12-07T20:15:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now: actual });
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
    const response = await NikolausFahrtVisit(
      staffRequest('POST', booking.id, true, getDispoVisitVersion(await plannedRow())),
      context
    );
    assert.equal(response.status, 200);
    assert.equal((response.jsonBody as { visitedAt: string }).visitedAt, '21:15');
    assert.equal((await plannedRow()).visitedAt, actual.toISOString());
    const schedule = getNikolausRetentionSchedule(
      await loadRetentionSources(),
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
    const undo = await NikolausFahrtVisit(
      staffRequest('POST', booking.id, false, getDispoVisitVersion(await plannedRow())),
      context
    );
    assert.equal(undo.status, 200);
    assert.equal((await plannedRow()).visitedAt, '');
    // The actual visit still counts for the deadline after the check-off was undone
    const after = getNikolausRetentionSchedule(
      await loadRetentionSources(),
      new Date('2027-01-07T00:00:00Z')
    );
    assert.equal(after.policies[0].lastVisit, '2026-12-07');
  }
);

dbTest('dated same-day visits remain usable in the public route progress calculation', async () => {
  const actual = new Date('2026-12-05T16:15:00.000Z');
  const { booking, token } = await insertBooking(`${DATE}T17:00`);
  await insertDispo(booking.id, DATE, { visitedAt: actual });
  const { mock } = await import('node:test');
  mock.timers.enable({ apis: ['Date'], now: actual });
  try {
    const response = await GetNikolausProgressEndpoint(
      new HttpRequest({
        method: 'POST',
        url: 'https://example.test/api/nikolaus/manage/progress',
        body: { string: JSON.stringify({ token }) },
      })
    );
    assert.equal(response.status, 200);
    assert.equal((response.jsonBody as { phase: string }).phase, 'today');
    assert.equal((response.jsonBody as { delayMinutes: number }).delayMinutes, 5);
    assert.equal((response.jsonBody as { visited: boolean }).visited, true);
  } finally {
    mock.timers.reset();
  }
});

dbTest('a booking moved within the day rejects an offline mark for the old slot', async (t) => {
  setupSharedState(t);
  const { booking } = await insertBooking(`${DATE}T17:00`);
  await insertDispo(booking.id, DATE);
  await getDb()
    .updateTable('nikolaus.booking')
    .set({ slot_key: `${DATE}T18:00` })
    .where('id', '=', Number(booking.id))
    .execute();
  const context = new InvocationContext();
  t.mock.method(context, 'log', () => undefined);
  const response = await NikolausFahrtVisit(
    staffRequest('POST', booking.id, true, getDispoVisitVersion(await plannedRow())),
    context
  );
  assert.equal(response.status, 409);
  assert.equal((await plannedRow()).visited, false);
});
