import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { getDb } from '../lib/db';
import { getBooking } from '../lib/nikolaus-bookings';
import { getAllDispoRows } from '../lib/nikolaus-dispo-list';
import {
  getEinteilungRows,
  saveEinteilung,
  getEinteilungVersion,
} from '../lib/nikolaus-einteilung-list';
import { getHelpers } from '../lib/nikolaus-helfende-list';
import {
  applyNikolausRetention,
  getRetentionTargetDigest,
  loadRetentionSources,
  planNikolausRetention,
} from '../lib/nikolaus-retention';
import { runAutomaticNikolausRetention } from '../lib/nikolaus-retention-auto';
import { readNikolausState } from '../lib/nikolaus-state';
import { dbTest } from './fixtures/database';
import { insertBooking, insertDispo, insertHelper } from './fixtures/nikolaus-data';
import { setupSharedState } from './fixtures/shared-state';

const OPTIONS = { season: 2026, before: '2026-12-07', responsibleRole: 'Test' };
const JANUARY = new Date('2027-01-31T12:00:00Z');
const TARGET = getRetentionTargetDigest();

/** Season 2026 (visits on 5 and 6 December) and data of the next season. */
async function seed() {
  const visited = (await insertBooking('2026-12-05T17:00')).booking;
  const cancelled = (await insertBooking('2026-12-06T18:00', { status: 'Storniert' })).booking;
  const nextSeason = (await insertBooking('2027-12-05T17:00')).booking;
  await insertDispo(visited.id, '2026-12-05', { visitedAt: new Date('2026-12-05T16:20:00Z') });
  const helper = await insertHelper({
    name: 'Anna',
    availability: { '2026-12-05': ['Nikolaus'] },
  });
  const later = await insertHelper({
    name: 'Ben',
    availability: { '2026-12-05': ['Krampus'], '2027-12-05': ['Krampus'] },
  });
  await saveEinteilung(
    [
      { personId: helper, date: '2026-12-05', team: 'A', role: 'Nikolaus', fixed: false },
      { personId: later, date: '2026-12-05', team: 'A', role: 'Krampus', fixed: false },
    ],
    getEinteilungVersion([])
  );
  await getDb()
    .insertInto('nikolaus.state')
    .values({
      state_key: 'geocoding:nominatim',
      value: JSON.stringify({
        version: 1,
        nextRequestAt: 1234,
        cache: [{ key: 'a'.repeat(64), expires: Date.now() + 60_000, result: { found: false } }],
      }),
    })
    .execute();
  return { visited, cancelled, nextSeason, helper, later };
}

dbTest('the preview names only IDs and counts and deletes nothing', async () => {
  const data = await seed();
  const plan = planNikolausRetention(await loadRetentionSources(), OPTIONS);
  assert.deepEqual(plan.bookingIds.sort(), [data.visited.id, data.cancelled.id].sort());
  assert.deepEqual(plan.helperIds, [data.helper]);
  assert.deepEqual(plan.dates, ['2026-12-05']);
  assert.equal(plan.dispoRows, 1);
  assert.equal(plan.einteilungRows, 2);
  assert.equal(plan.geocodingCacheEntries, 1);
  assert.deepEqual(plan.retained, [
    { kind: 'helper', id: data.later, reason: 'availability_outside_cutoff' },
  ]);
  assert.equal(JSON.stringify(plan).includes('Testfamilie'), false);
  assert.ok(await getBooking(data.visited.id));
});

dbTest('a run deletes the season in one transaction and keeps the next season', async () => {
  const data = await seed();
  const report = await applyNikolausRetention(OPTIONS, JANUARY);
  assert.deepEqual(report.deleted, {
    bookings: 2,
    helpers: 1,
    dispoRows: 1,
    einteilungRows: 2,
    geocodingCacheEntries: 1,
  });
  assert.equal(report.complete, false);
  assert.equal(await getBooking(data.visited.id), undefined);
  assert.equal(await getBooking(data.cancelled.id), undefined);
  assert.ok(await getBooking(data.nextSeason.id));
  assert.deepEqual(await getAllDispoRows(), []);
  assert.deepEqual(await getEinteilungRows(), []);
  assert.deepEqual(
    (await getHelpers()).map((helper) => helper.id),
    [data.later]
  );
  const geocoding = (await readNikolausState('geocoding:nominatim'))?.data as {
    nextRequestAt: number;
    cache: unknown[];
  };
  assert.deepEqual(geocoding.cache, []);
  assert.equal(geocoding.nextRequestAt, 1234);
  // A repeated run finds nothing more to delete
  const again = await applyNikolausRetention(OPTIONS, JANUARY);
  assert.equal(again.deleted.bookings, 0);
});

dbTest('a failed run deletes nothing', async (t) => {
  const data = await seed();
  const prototype = Object.getPrototypeOf(getDb()) as { deleteFrom: (table: never) => unknown };
  const original = prototype.deleteFrom;
  let calls = 0;
  // Fails the third delete inside the transaction, after two deletes ran
  t.mock.method(prototype, 'deleteFrom', function (this: unknown, table: never) {
    if (++calls === 3) throw new Error('Simulated failure in the middle');
    return original.call(this, table);
  });
  await assert.rejects(applyNikolausRetention(OPTIONS, JANUARY), /Simulated failure/);
  t.mock.restoreAll();
  assert.ok(await getBooking(data.visited.id));
  assert.equal((await getAllDispoRows()).length, 1);
  assert.equal((await getEinteilungRows()).length, 2);
});

dbTest('a cutoff in the future is refused before reading data', async () => {
  await assert.rejects(
    applyNikolausRetention({ ...OPTIONS, before: '2027-02-01' }, JANUARY),
    /future/
  );
});

dbTest('the automatic run requires the configured target', async () => {
  await seed();
  await assert.rejects(
    runAutomaticNikolausRetention(
      { targetDigest: TARGET, expectedTargetDigest: 'b'.repeat(64) },
      { dryRun: false, now: JANUARY }
    ),
    /not explicitly configured/
  );
  assert.equal((await loadRetentionSources()).bookings.length, 3);
});

dbTest('the automatic preview writes nothing and the run deletes due seasons only', async (t) => {
  setupSharedState(t);
  const data = await seed();
  const deps = { targetDigest: TARGET, expectedTargetDigest: TARGET };
  // One calendar month after the last activity of the season (Einteilung on 5 December)
  const early = await runAutomaticNikolausRetention(deps, {
    dryRun: false,
    now: new Date('2027-01-04T12:00:00Z'),
  });
  assert.equal(early.status, 'idle');
  assert.ok(await getBooking(data.visited.id));
  assert.ok(await readNikolausState('retention:schedule:2026'));

  const preview = await runAutomaticNikolausRetention(deps, { dryRun: true, now: JANUARY });
  assert.equal(preview.status, 'preview');
  assert.deepEqual(preview.dueSeasons, [2026]);
  assert.ok(await getBooking(data.visited.id));

  const result = await runAutomaticNikolausRetention(deps, { dryRun: false, now: JANUARY });
  assert.equal(result.status, 'partial');
  assert.equal(result.reports[0].deleted.bookings, 2);
  assert.ok(await getBooking(data.nextSeason.id));
  const run = (await readNikolausState('retention:run:2026'))?.data as {
    report: { deleted: { bookings: number } };
  };
  assert.equal(run.report.deleted.bookings, 2);
});

test('the retention CLI shows the target and stays disabled without credentials', () => {
  const script = resolve(process.cwd(), 'scripts/nikolaus-retention-auto.ts');
  const env = { ...process.env, AZURE_CLIENT_CERT: '', NIKOLAUS_RETENTION_ENABLED: '' };
  const target = spawnSync('bun', [script, '--show-target'], { encoding: 'utf8', env });
  assert.equal(target.status, 0, target.stderr);
  assert.ok(target.stdout.includes(TARGET));
  const disabled = spawnSync('bun', [script], { encoding: 'utf8', env });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.ok(disabled.stdout.includes('disabled'));
});
