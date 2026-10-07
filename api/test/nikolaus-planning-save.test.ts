import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  getDispoRows,
  getDispoVersion,
  getDispoVisitVersion,
  saveDispo,
  setDispoVisited,
} from '../lib/nikolaus-dispo-list';
import type { DispoEntry } from '../lib/nikolaus-dispo-list';
import {
  getEinteilungRows,
  getEinteilungVersion,
  saveEinteilung,
} from '../lib/nikolaus-einteilung-list';
import { deleteHelper, getHelper, getHelpers, updateHelper } from '../lib/nikolaus-helfende-list';
import { deleteBooking } from '../lib/nikolaus-bookings';
import { NikolausStateConflictError, readNikolausState } from '../lib/nikolaus-state';
import { retentionScheduleKey } from '../lib/nikolaus-retention-schedule';
import { dbTest } from './fixtures/database';
import { insertBooking, insertHelper } from './fixtures/nikolaus-data';

const DATE = '2026-12-05';
const EMPTY = getDispoVersion([]);

function entry(bookingId: string, order: number, team = 'A'): DispoEntry {
  return {
    bookingId,
    team,
    order,
    slotKey: `${DATE}T17:00`,
    plannedArrival: `17:${String(order).padStart(2, '0')}`,
    fixed: false,
  };
}

function assignment(personId: string, date = DATE, team = 'A') {
  return { personId, date, team, role: 'Nikolaus' as const, fixed: false };
}

dbTest('a Dispo is saved whole, and saving it again changes nothing', async () => {
  const first = (await insertBooking(`${DATE}T17:00`)).booking.id;
  const second = (await insertBooking(`${DATE}T17:00`)).booking.id;
  await saveDispo(DATE, [entry(first, 1), entry(second, 2)], EMPTY);
  const rows = await getDispoRows(DATE);
  assert.deepEqual(
    rows.map((row) => [row.bookingId, row.order, row.plannedArrival]),
    [
      [first, 1, '17:01'],
      [second, 2, '17:02'],
    ]
  );
  // A retry after a lost response sends the old version, but the same plan
  await saveDispo(DATE, [entry(first, 1), entry(second, 2)], EMPTY);
  assert.equal(getDispoVersion(await getDispoRows(DATE)), getDispoVersion(rows));
});

dbTest('concurrent initial Dispo saves keep exactly one plan', async () => {
  const id = (await insertBooking(`${DATE}T17:00`)).booking.id;
  const results = await Promise.allSettled([
    saveDispo(DATE, [entry(id, 1, 'A')], EMPTY),
    saveDispo(DATE, [entry(id, 1, 'B')], EMPTY),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.reason instanceof NikolausStateConflictError);
  assert.equal((await getDispoRows(DATE)).length, 1);
});

dbTest('a stale Dispo version conflicts and replanning keeps checked-off visits', async () => {
  const id = (await insertBooking(`${DATE}T17:00`)).booking.id;
  await saveDispo(DATE, [entry(id, 1)], EMPTY);
  const loaded = await getDispoRows(DATE);
  await setDispoVisited(loaded[0], true, '2026-12-05T16:10:00.000Z');
  // Checking off does not change the planning version
  const version = getDispoVersion(await getDispoRows(DATE));
  assert.equal(version, getDispoVersion(loaded));
  await saveDispo(DATE, [entry(id, 1, 'B')], version);
  const replanned = await getDispoRows(DATE);
  assert.equal(replanned[0].team, 'B');
  assert.equal(replanned[0].visitedAt, '2026-12-05T16:10:00.000Z');
  await assert.rejects(saveDispo(DATE, [entry(id, 1, 'A')], version), NikolausStateConflictError);
});

dbTest('a Dispo with a booking deleted meanwhile is a conflict', async () => {
  const { booking } = await insertBooking(`${DATE}T17:00`);
  await deleteBooking(booking.id, booking.etag);
  await assert.rejects(saveDispo(DATE, [entry(booking.id, 1)], EMPTY), NikolausStateConflictError);
});

dbTest('offline visit retries are idempotent and stale offline versions are rejected', async () => {
  const id = (await insertBooking(`${DATE}T17:00`)).booking.id;
  await saveDispo(DATE, [entry(id, 1)], EMPTY);
  const row = (await getDispoRows(DATE))[0];
  const mutation = { operationId: randomUUID(), version: getDispoVisitVersion(row) };
  const visited = await setDispoVisited(row, true, '2026-12-05T16:10:00.000Z', mutation);
  assert.equal(visited.visited, true);
  // The same operation again (lost response) returns the saved row without a change
  const retry = await setDispoVisited(row, true, '2026-12-05T16:20:00.000Z', mutation);
  assert.equal(retry.visitedAt, '2026-12-05T16:10:00.000Z');
  // Another device still holding the old version cannot undo it
  await assert.rejects(
    setDispoVisited(row, false, '', { operationId: randomUUID(), version: mutation.version }),
    NikolausStateConflictError
  );
  const undone = await setDispoVisited(visited, false, '', {
    operationId: randomUUID(),
    version: getDispoVisitVersion(visited),
  });
  assert.equal(undone.visited, false);
});

dbTest(
  'the actual visit date is kept for the retention deadline when a visit is undone',
  async () => {
    const id = (await insertBooking(`${DATE}T17:00`)).booking.id;
    await saveDispo(DATE, [entry(id, 1)], EMPTY);
    const row = (await getDispoRows(DATE))[0];
    const visited = await setDispoVisited(row, true, '2026-12-06T23:30:00.000Z');
    await setDispoVisited(visited, false, '');
    const policy = (await readNikolausState(retentionScheduleKey(2026)))?.data as {
      lastVisit: string;
    };
    assert.equal(policy.lastVisit, '2026-12-07');
  }
);

dbTest('the Einteilung is saved whole with a version and follows its helpers', async () => {
  const anna = await insertHelper({ name: 'Anna', availability: { [DATE]: ['Nikolaus'] } });
  const ben = await insertHelper({ name: 'Ben' });
  const empty = getEinteilungVersion([]);
  await saveEinteilung([assignment(anna), assignment(ben, DATE, 'B')], empty);
  const rows = await getEinteilungRows();
  assert.deepEqual(
    rows.map((row) => [row.name, row.team]),
    [
      ['Anna', 'A'],
      ['Ben', 'B'],
    ]
  );
  await assert.rejects(saveEinteilung([assignment(anna)], empty), NikolausStateConflictError);

  // Renaming needs no update of the Einteilung; deleting removes the person's assignments
  const helper = (await getHelper(anna))!;
  await updateHelper(anna, { ...helper, name: 'Anna B.' }, helper.etag);
  assert.equal((await getEinteilungRows())[0].name, 'Anna B.');
  await deleteHelper(ben, (await getHelper(ben))!.etag);
  assert.deepEqual(
    (await getEinteilungRows()).map((row) => row.personId),
    [anna]
  );
});

dbTest('concurrent initial Einteilung saves keep exactly one plan', async () => {
  const anna = await insertHelper({ name: 'Anna' });
  const empty = getEinteilungVersion([]);
  const results = await Promise.allSettled([
    saveEinteilung([assignment(anna, DATE, 'A')], empty),
    saveEinteilung([assignment(anna, DATE, 'B')], empty),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await getEinteilungRows()).length, 1);
});

dbTest('an Einteilung with a helper deleted meanwhile is a conflict', async () => {
  const anna = await insertHelper({ name: 'Anna' });
  await deleteHelper(anna);
  await assert.rejects(
    saveEinteilung([assignment(anna)], getEinteilungVersion([])),
    NikolausStateConflictError
  );
});

dbTest('helpers keep availability in role order and stale versions conflict', async () => {
  const id = await insertHelper({
    name: 'Clara',
    availability: { '2026-12-06': ['Küche', 'Nikolaus'], [DATE]: ['Engerl'] },
    positiveTags: ['Rover'],
  });
  const helper = (await getHelpers()).find((entry) => entry.id === id)!;
  assert.deepEqual(helper.availability, {
    [DATE]: ['Engerl'],
    '2026-12-06': ['Nikolaus', 'Küche'],
  });
  assert.deepEqual(helper.positiveTags, ['Rover']);
  await updateHelper(id, { ...helper, notes: 'neu' }, helper.etag);
  await assert.rejects(updateHelper(id, { ...helper, notes: 'alt' }, helper.etag), {
    statusCode: 412,
  });
  assert.equal((await getHelper(id))!.notes, 'neu');
});
