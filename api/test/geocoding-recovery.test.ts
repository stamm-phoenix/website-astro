import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import {
  GeocodingRecoveryError,
  readGeocodingReservationStatus,
  recoverStoppedGeocodingReservation,
} from '../lib/geocoding-recovery';
import { readNikolausState } from '../lib/nikolaus-state';
import { NIKOLAUS_WRITE_GATE_KEY } from '../lib/nikolaus-write-gate';
import { setupSharedState } from './fixtures/shared-state';

const KEY = 'geocoding:nominatim';
const RESERVATION = {
  version: 1,
  nextRequestAt: 1234,
  lease: { owner: 'geo-owner', key: 'private-address-hash', expires: 1200, startedAt: 1000 },
  cache: [{ key: 'private-address-hash', expires: Date.now() + 60_000, result: { found: false } }],
};
const MAINTENANCE = {
  schema: 1,
  writers: [],
  maintenance: { owner: 'job-owner', startedAt: '2026-01-01' },
};

test('status reveals reservation owner and time without cache, locations or address hashes', async (t) => {
  const state = setupSharedState(t);
  state.seed(KEY, RESERVATION);
  const status = await readGeocodingReservationStatus();
  assert.deepEqual(status, { owner: 'geo-owner', startedAt: 1000 });
  assert.equal(JSON.stringify(status).includes('private'), false);
  assert.deepEqual(state.writes, { creates: 0, updates: 0, deletes: 0 });
});

test('recovery preserves cache and pacing, removes only the stopped owner and is safe to repeat', async (t) => {
  const state = setupSharedState(t);
  state.seed(KEY, RESERVATION);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  const before = Date.now();
  await recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true });
  const recovered = (await readNikolausState(KEY))?.data as typeof RESERVATION;
  assert.equal(recovered.lease, undefined);
  assert.deepEqual(recovered.cache, RESERVATION.cache);
  assert.ok(recovered.nextRequestAt >= before + 6100);
  assert.ok((await readNikolausState(NIKOLAUS_WRITE_GATE_KEY))?.data);
  const writes = state.writes.updates;
  await recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true });
  assert.equal(state.writes.updates, writes);
  assert.deepEqual((await readNikolausState(KEY))?.data, recovered);
});

for (const [name, gate] of [
  ['missing maintenance', { schema: 1, writers: [] }],
  [
    'foreign maintenance',
    { ...MAINTENANCE, maintenance: { ...MAINTENANCE.maintenance, owner: 'foreign' } },
  ],
  [
    'remaining writer',
    { ...MAINTENANCE, writers: [{ id: 'live-writer', startedAt: '2026-01-01' }] },
  ],
] as const) {
  test(`recovery refuses ${name} without changing the reservation`, async (t) => {
    const state = setupSharedState(t);
    state.seed(KEY, RESERVATION);
    state.seed(NIKOLAUS_WRITE_GATE_KEY, gate);
    await assert.rejects(
      recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true }),
      GeocodingRecoveryError
    );
    assert.deepEqual(state.writes, { creates: 0, updates: 0, deletes: 0 });
  });
}

test('a newer geocoding owner cannot be removed even after a successful stale preview', async (t) => {
  const state = setupSharedState(t);
  state.seed(KEY, RESERVATION);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  assert.equal((await readGeocodingReservationStatus()).owner, 'geo-owner');
  const geo = [...state.rows.values()].find((row) => row.fields.OperationKey === KEY)!;
  geo.fields.State = JSON.stringify({
    ...RESERVATION,
    lease: { ...RESERVATION.lease, owner: 'new-owner' },
  });
  await assert.rejects(
    recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true }),
    (error: unknown) =>
      error instanceof GeocodingRecoveryError && error.code === 'GEOCODING_OWNER_MISMATCH'
  );
  assert.equal(state.writes.updates, 0);
});

test('ambiguous recovery response can be retried without discarding cooldown or cache', async (t) => {
  const state = setupSharedState(t);
  state.seed(KEY, RESERVATION);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, MAINTENANCE);
  const originalUpdate = sharePoint.updateSharePointListItem;
  t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (...args: Parameters<typeof originalUpdate>) => {
      await originalUpdate(...args);
      throw new Error('Saved response lost');
    }
  );
  await assert.rejects(
    recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true })
  );
  const recovered = (await readNikolausState(KEY))?.data;
  await recoverStoppedGeocodingReservation('geo-owner', 'job-owner', { confirmedStopped: true });
  assert.deepEqual((await readNikolausState(KEY))?.data, recovered);
  assert.equal(state.writes.updates, 1);
});

test('CLI help and invalid recovery arguments do not require credentials or access a list', () => {
  const script = resolve(process.cwd(), 'scripts/nikolaus-maintenance.ts');
  const env = { ...process.env, SHAREPOINT_NIKOLAUS_STATE_LIST_ID: '', AZURE_CLIENT_CERT: '' };
  const help = spawnSync('bun', [script, '--help'], { encoding: 'utf8', env });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes('--geocoding-owner'));
  for (const argv of [
    ['--recover', '--owner', 'job-owner', '--geocoding-owner', 'geo-owner'],
    [
      '--recover',
      '--owner',
      'job-owner',
      '--geocoding-owner',
      'invalid/value',
      '--processes-stopped-confirmed',
    ],
    ['--recover', '--owner', 'job-owner', '--unexpected', '--processes-stopped-confirmed'],
  ]) {
    const result = spawnSync('bun', [script, ...argv], { encoding: 'utf8', env });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stderr) as { errorCode: string };
    assert.ok(
      ['RECOVERY_CONFIRMATION_REQUIRED', 'INVALID_GEOCODING_OWNER', 'INVALID_ARGUMENTS'].includes(
        output.errorCode
      )
    );
  }
});
