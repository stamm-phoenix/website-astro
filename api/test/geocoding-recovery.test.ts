import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import {
  GeocodingRecoveryError,
  readGeocodingReservationStatus,
  recoverStoppedGeocodingReservation,
} from '../lib/geocoding-recovery';
import { readNikolausState } from '../lib/nikolaus-state';
import { dbTest } from './fixtures/database';
import { setupSharedState } from './fixtures/shared-state';

const KEY = 'geocoding:nominatim';
const RESERVATION = {
  version: 1,
  nextRequestAt: 1234,
  lease: { owner: 'geo-owner', key: 'private-address-hash', expires: 1200, startedAt: 1000 },
  cache: [{ key: 'private-address-hash', expires: Date.now() + 60_000, result: { found: false } }],
};

async function stateVersion(): Promise<string> {
  const row = await getDb()
    .selectFrom('nikolaus.state')
    .select('version')
    .where('state_key', '=', KEY)
    .executeTakeFirstOrThrow();
  return row.version.toString('hex');
}

dbTest(
  'status reveals reservation owner and time without cache, locations or address hashes',
  async (t) => {
    const state = setupSharedState(t);
    await state.seed(KEY, RESERVATION);
    const version = await stateVersion();
    const status = await readGeocodingReservationStatus();
    assert.deepEqual(status, { owner: 'geo-owner', startedAt: 1000 });
    assert.equal(JSON.stringify(status).includes('private'), false);
    assert.equal(await stateVersion(), version);
  }
);

dbTest(
  'recovery preserves cache and pacing, removes only the stopped owner and is safe to repeat',
  async (t) => {
    const state = setupSharedState(t);
    await state.seed(KEY, RESERVATION);
    const before = Date.now();
    await recoverStoppedGeocodingReservation('geo-owner', { confirmedStopped: true });
    const recovered = (await readNikolausState(KEY))?.data as typeof RESERVATION;
    assert.equal(recovered.lease, undefined);
    assert.deepEqual(recovered.cache, RESERVATION.cache);
    assert.ok(recovered.nextRequestAt >= before + 6100);
    const version = await stateVersion();
    await recoverStoppedGeocodingReservation('geo-owner', { confirmedStopped: true });
    assert.equal(await stateVersion(), version);
    assert.deepEqual((await readNikolausState(KEY))?.data, recovered);
  }
);

dbTest('recovery requires the explicit confirmation that old processes stopped', async (t) => {
  const state = setupSharedState(t);
  await state.seed(KEY, RESERVATION);
  const version = await stateVersion();
  await assert.rejects(
    recoverStoppedGeocodingReservation('geo-owner', {} as { confirmedStopped: true }),
    GeocodingRecoveryError
  );
  assert.equal(await stateVersion(), version);
});

dbTest(
  'a newer geocoding owner cannot be removed even after a successful stale preview',
  async (t) => {
    const state = setupSharedState(t);
    await state.seed(KEY, RESERVATION);
    assert.equal((await readGeocodingReservationStatus()).owner, 'geo-owner');
    await getDb()
      .updateTable('nikolaus.state')
      .set({
        value: JSON.stringify({
          ...RESERVATION,
          lease: { ...RESERVATION.lease, owner: 'new-owner' },
        }),
      })
      .where('state_key', '=', KEY)
      .execute();
    const version = await stateVersion();
    await assert.rejects(
      recoverStoppedGeocodingReservation('geo-owner', { confirmedStopped: true }),
      (error: unknown) =>
        error instanceof GeocodingRecoveryError && error.code === 'GEOCODING_OWNER_MISMATCH'
    );
    assert.equal(await stateVersion(), version);
  }
);
