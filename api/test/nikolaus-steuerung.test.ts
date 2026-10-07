import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import {
  NikolausSteuerungDelete,
  NikolausSteuerungSave,
  NikolausSteuerung,
} from '../endpoints/intern-nikolaus-steuerung';
import { GetNikolausSettingsEndpoint } from '../endpoints/nikolaus-settings';
import * as geocoding from '../lib/geocoding';
import { getDb } from '../lib/db';
import type { NikolausSettings } from '../lib/nikolaus-config';
import { getNikolausSlots } from '../lib/nikolaus-config';
import { addCalendarMonth, getCleanupStatus } from '../lib/nikolaus-cleanup';
import { createBooking } from '../lib/nikolaus-bookings';
import {
  loadNikolausSettings,
  saveNikolausSettings,
  validateNikolausSettings,
} from '../lib/nikolaus-settings';
import { ValidationError } from '../lib/pflege-validation';
import { mutateNikolausState, readNikolausState } from '../lib/nikolaus-state';
import { dbTest } from './fixtures/database';
import { FAMILY, insertBooking, insertDispo, insertHelper } from './fixtures/nikolaus-data';
import { TEST_SETTINGS } from './fixtures/nikolaus-settings';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

const NOW = new Date('2026-11-01T12:00:00Z');

function request(method: string, body?: unknown): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/pflege/nikolaus-steuerung',
    method,
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'warn', () => undefined);
  return result;
}

function settings(patch: Partial<NikolausSettings> = {}): NikolausSettings {
  return structuredClone({ ...TEST_SETTINGS, ...patch });
}

/** Records the requested website builds instead of calling GitHub. */
function captureRebuilds(t: TestContext): string[] {
  const areas: string[] = [];
  const previous = process.env.GITHUB_REBUILD_TOKEN;
  process.env.GITHUB_REBUILD_TOKEN = 'test-token';
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_REBUILD_TOKEN;
    else process.env.GITHUB_REBUILD_TOKEN = previous;
  });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    areas.push(
      (JSON.parse(String(init.body)) as { client_payload: { area: string } }).client_payload.area
    );
    return new Response(null, { status: 204 });
  });
  return areas;
}

function body(response: HttpResponseInit): Record<string, unknown> {
  return response.jsonBody as Record<string, unknown>;
}

test('the settings form is validated per field', () => {
  assert.deepEqual(validateNikolausSettings(settings()), settings());
  const invalid = {
    ...settings(),
    publicActive: 'yes',
    pendingHoldMinutes: 2,
    days: [
      { date: '2026-12-05', start: '17:00', end: '17:15', teams: 2 },
      { date: '2026-12-05', start: '18:00', end: '21:00', teams: 5 },
      { date: '2026-02-30', start: '25:00', end: '21:00', teams: 1 },
    ],
    area: { ...settings().area, servicePostalCodes: ['8362'] },
  };
  try {
    validateNikolausSettings(invalid);
    assert.fail('expected a validation error');
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    assert.deepEqual(Object.keys(error.fields).sort(), [
      'area.servicePostalCodes',
      'days.0.end',
      'days.1.date',
      'days.1.teams',
      'days.2.date',
      'days.2.start',
      'pendingHoldMinutes',
      'publicActive',
    ]);
  }
});

dbTest('the seeded settings match the former configuration and the public endpoint', async () => {
  const stored = await loadNikolausSettings();
  assert.deepEqual(stored.settings, TEST_SETTINGS);
  const response = await GetNikolausSettingsEndpoint();
  const publicSettings = response.jsonBody as Record<string, unknown>;
  assert.equal(publicSettings.publicActive, false);
  assert.equal('maintenance' in publicSettings, false);
  assert.equal('staffActive' in publicSettings, false);
});

dbTest(
  'saving checks the version, logs the change and rebuilds only for public changes',
  async (t) => {
    const rebuilds = captureRebuilds(t);
    const { etag } = await loadNikolausSettings();

    const internal = await NikolausSteuerungSave(
      request('PUT', { etag, settings: settings({ maintenance: true }) }),
      context(t)
    );
    assert.equal(internal.status, 200);
    assert.equal((body(internal).settings as NikolausSettings).maintenance, true);
    assert.deepEqual(rebuilds, []);

    // The old version is refused
    const stale = await NikolausSteuerungSave(
      request('PUT', { etag, settings: settings({ publicActive: true }) }),
      context(t)
    );
    assert.equal(stale.status, 409);

    const days = [
      ...TEST_SETTINGS.days,
      { date: '2026-12-07', start: '16:00', end: '18:00', teams: 1 },
    ];
    const current = (await loadNikolausSettings()).etag;
    const saved = await NikolausSteuerungSave(
      request('PUT', {
        etag: current,
        settings: settings({ maintenance: true, publicActive: true, days }),
      }),
      context(t)
    );
    assert.equal(saved.status, 200);
    assert.deepEqual(rebuilds, ['nikolaus']);
    const stored = await loadNikolausSettings();
    assert.deepEqual(stored.settings.days, days);
    assert.equal(stored.updatedBy, 'staff@example.test');
    assert.equal(
      getNikolausSlots(stored.settings).filter((s) => s.date === '2026-12-07').length,
      4
    );

    const view = body(await NikolausSteuerung(request('GET'), context(t)));
    const log = view.log as { action: string; actor: string; details: { changes: object } }[];
    assert.deepEqual(
      log.map((entry) => Object.keys(entry.details.changes).sort()),
      [['days', 'publicActive'], ['maintenance']]
    );
    assert.equal(log[0].actor, 'staff@example.test');
  }
);

dbTest(
  'days and teams cannot be removed under bookings and plans that are still ahead',
  async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const [first] = getNikolausSlots(TEST_SETTINGS);
    const a = await insertBooking(first.key);
    await insertBooking(first.key);
    // Past seasons do not block a new one
    await insertBooking('2025-12-05T17:00');
    await insertDispo(a.booking.id, '2026-12-06', { team: 'C' });
    const { etag } = await loadNikolausSettings();

    const fewerTeams = settings({
      days: [
        { ...TEST_SETTINGS.days[0], teams: 1 },
        { ...TEST_SETTINGS.days[1], teams: 2 },
      ],
    });
    await assert.rejects(saveNikolausSettings(fewerTeams, etag, 'staff', NOW), (error: unknown) => {
      const conflicts = (error as { conflicts: string[] }).conflicts;
      assert.equal(conflicts.length, 2);
      assert.match(conflicts[0], /2 Anmeldungen, aber nur 1 Team/);
      assert.match(conflicts[1], /Team C/);
      return true;
    });

    const later = settings({
      days: [{ ...TEST_SETTINGS.days[0], start: '18:00' }, TEST_SETTINGS.days[1]],
    });
    await assert.rejects(saveNikolausSettings(later, etag, 'staff', NOW), /passen nicht/);

    // Nothing was changed
    assert.deepEqual((await loadNikolausSettings()).settings, TEST_SETTINGS);
  }
);

dbTest('a booking checks the capacity of the slot as configured at that moment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(geocoding, 'geocodeAddress', async () => ({ found: false }));
  const slot = getNikolausSlots(TEST_SETTINGS)[0];
  // The Steuerung reduced the teams after the request loaded the settings
  await getDb()
    .updateTable('nikolaus.day')
    .set({ teams: 1 })
    .where('date', '=', slot.date)
    .execute();
  await insertBooking(slot.key);
  const result = await createBooking(
    { ...FAMILY, email: 'late@example.test' },
    slot,
    TEST_SETTINGS,
    NOW
  );
  assert.deepEqual(result, { ok: false, reason: 'SLOT_FULL' });
});

dbTest('deleting needs the typed confirmation and removes exactly one area', async (t) => {
  const { booking } = await insertBooking('2026-12-06T18:00');
  await insertDispo(booking.id, '2026-12-06', { visitedAt: new Date('2026-12-06T17:10:00Z') });
  await insertHelper({ name: 'Anna', availability: { '2026-12-05': ['Nikolaus'] } });
  await mutateNikolausState(
    'geocoding:nominatim',
    (value) => (value as object | undefined) ?? { version: 1, nextRequestAt: 0, cache: [] },
    () => ({
      version: 1,
      nextRequestAt: 5,
      cache: [{ key: 'hash', expires: Date.now() + 60_000, result: { found: false } }],
    })
  );

  const before = await getCleanupStatus(new Date('2027-01-05T12:00:00Z'));
  assert.equal(before.lastVisit, '2026-12-06');
  assert.equal(before.deleteBy, '2027-01-06');
  assert.equal(before.due, false);
  assert.equal((await getCleanupStatus(new Date('2027-01-06T12:00:00Z'))).due, true);

  const wrong = await NikolausSteuerungDelete(
    request('POST', { scope: 'bookings', confirmation: 'anmeldungen löschen' }),
    context(t)
  );
  assert.equal(wrong.status, 400);
  assert.equal((await getCleanupStatus()).bookings, 1);

  const deleted = await NikolausSteuerungDelete(
    request('POST', { scope: 'bookings', confirmation: 'ANMELDUNGEN LÖSCHEN' }),
    context(t)
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(body(deleted).deleted, { dispoVisits: 1, bookings: 1, geocodingCache: 1 });
  const after = await getCleanupStatus();
  assert.equal(after.bookings, 0);
  assert.equal(after.dispoVisits, 0);
  assert.equal(after.helpers, 1);
  assert.equal(after.lastVisit, null);
  const geocoding = (await readNikolausState('geocoding:nominatim'))?.data as {
    nextRequestAt: number;
    cache: unknown[];
  };
  assert.deepEqual(geocoding.cache, []);
  assert.equal(geocoding.nextRequestAt, 5);

  const helpers = await NikolausSteuerungDelete(
    request('POST', { scope: 'helpers', confirmation: 'HELFENDE LÖSCHEN' }),
    context(t)
  );
  assert.equal(helpers.status, 200);
  assert.equal((await getCleanupStatus()).helpers, 0);

  const log = body(await NikolausSteuerung(request('GET'), context(t))).log as { action: string }[];
  assert.deepEqual(
    log.map((entry) => entry.action),
    ['delete-helpers', 'delete-bookings']
  );
});

test('the online booking needs at least one day', () => {
  assert.throws(
    () => validateNikolausSettings(settings({ publicActive: true, days: [] })),
    (error: unknown) => error instanceof ValidationError && 'days' in error.fields
  );
  assert.deepEqual(validateNikolausSettings(settings({ days: [] })).days, []);
});

test('the deletion deadline is one calendar month later, clamped at month ends', () => {
  assert.equal(addCalendarMonth('2026-12-06'), '2027-01-06');
  assert.equal(addCalendarMonth('2027-01-31'), '2027-02-28');
  assert.equal(addCalendarMonth('2028-01-31'), '2028-02-29');
});
