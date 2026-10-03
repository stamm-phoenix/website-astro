import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import { CONFIG } from '../lib/config';
import {
  deleteDispoOfBooking,
  getAllDispoRows,
  getDispoRows,
  getDispoVersion,
  saveDispo,
  setDispoVisited,
} from '../lib/nikolaus-dispo-list';
import type { DispoEntry } from '../lib/nikolaus-dispo-list';
import {
  deleteEinteilungOfPerson,
  getEinteilungRows,
  getEinteilungVersion,
  renameInEinteilung,
  saveEinteilung,
} from '../lib/nikolaus-einteilung-list';
import type { EinteilungSaveInput } from '../lib/pflege-validation';
import { getNikolausRetentionSchedule } from '../lib/nikolaus-retention-schedule';
import type { RetentionSources } from '../lib/nikolaus-retention';

const DATE = '2026-12-05';
const DISPO: DispoEntry[] = ['1', '2'].map((bookingId, index) => ({
  bookingId,
  team: 'A',
  order: index + 1,
  slotKey: `${DATE}T17:${index === 0 ? '00' : '30'}`,
  plannedArrival: index === 0 ? '17:00' : '17:30',
  fixed: index === 0,
}));
const EINTEILUNG: EinteilungSaveInput['assignments'] = [
  { personId: '1', date: DATE, team: 'A', role: 'Nikolaus', fixed: true },
  { personId: '2', date: DATE, team: 'A', role: 'Krampus', fixed: false },
];
const NAMES = new Map([
  ['1', 'Test Eins'],
  ['2', 'Test Zwei'],
]);
interface StoredItem {
  id: string;
  eTag: string;
  fields: Record<string, unknown>;
}

/** Simulates SharePoint's unique OperationKey and conditional updates, not the state helper. */
function setup(t: TestContext) {
  const items = new Map<string, StoredItem>();
  const legacy: StoredItem[] = [];
  let nextId = 1;
  let failure: 'before' | 'after' | undefined;
  let beforeWrite: (() => Promise<void>) | undefined;
  const statusError = (statusCode: number) =>
    Object.assign(new Error(`simulated ${statusCode}`), { statusCode });
  t.mock.method(
    sharePoint,
    'getSharePointListItems',
    async (list: string, options?: { filter?: string }) => {
      if (list !== CONFIG.sharepoint.lists.nikolausState) return structuredClone(legacy);
      const match = options?.filter?.match(/fields\/OperationKey eq '([^']+)'/);
      return structuredClone(
        [...items.values()].filter((row) => !match || row.fields.OperationKey === match[1])
      );
    }
  );
  async function write(action: () => void): Promise<void> {
    const hook = beforeWrite;
    beforeWrite = undefined;
    if (hook) await hook();
    const fail = failure;
    failure = undefined;
    if (fail === 'before') throw new Error('simulated transport failure');
    action();
    if (fail === 'after') throw new Error('simulated response lost after commit');
  }
  const create = t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (list: string, fields: Record<string, unknown>) => {
      assert.equal(
        list,
        CONFIG.sharepoint.lists.nikolausState,
        'planning never writes legacy rows'
      );
      let id = '';
      await write(() => {
        if ([...items.values()].some((row) => row.fields.OperationKey === fields.OperationKey))
          throw statusError(409);
        id = String(nextId++);
        items.set(id, { id, eTag: '"1"', fields: structuredClone(fields) });
      });
      return id;
    }
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      assert.equal(list, CONFIG.sharepoint.lists.nikolausState);
      await write(() => {
        const row = items.get(id);
        assert.ok(row);
        if (etag !== row.eTag) throw statusError(412);
        Object.assign(row.fields, fields);
        row.eTag = `"${Number(row.eTag.replaceAll('"', '')) + 1}"`;
      });
    }
  );
  const remove = t.mock.method(sharePoint, 'deleteSharePointListItem', async () => {
    assert.fail('planning never deletes legacy rows');
  });
  return {
    items,
    legacy,
    create,
    update,
    remove,
    fail: (when: 'before' | 'after') => {
      failure = when;
    },
    beforeWrite: (hook: () => Promise<void>) => {
      beforeWrite = hook;
    },
  };
}

test('concurrent initial Dispo saves never create duplicate bookings', async (t) => {
  const state = setup(t);
  const results = await Promise.allSettled([
    saveDispo(DATE, DISPO, []),
    saveDispo(DATE, [{ ...DISPO[0], team: 'B' }, DISPO[1]], []),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(state.items.size, 1);
  const rows = await getDispoRows(DATE);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.bookingId)).size, rows.length);
});

test('concurrent initial Einteilung saves never create duplicate person/day assignments', async (t) => {
  const state = setup(t);
  const results = await Promise.allSettled([
    saveEinteilung(EINTEILUNG, [], NAMES),
    saveEinteilung([{ ...EINTEILUNG[0], fixed: false }, EINTEILUNG[1]], [], NAMES),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(state.items.size, 1);
  const rows = await getEinteilungRows();
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => `${row.personId}|${row.date}`)).size, rows.length);
});

for (const kind of ['Dispo', 'Einteilung'] as const) {
  for (const failure of ['before', 'after'] as const) {
    test(`${kind}: retry after ${failure}-commit failure converges to one complete snapshot`, async (t) => {
      const state = setup(t);
      const save = () =>
        kind === 'Dispo' ? saveDispo(DATE, DISPO, []) : saveEinteilung(EINTEILUNG, [], NAMES);
      const load = () => (kind === 'Dispo' ? getDispoRows(DATE) : getEinteilungRows());
      state.fail(failure);
      await assert.rejects(save(), /simulated/);
      const rows = await load();
      assert.equal(rows.length, failure === 'before' ? 0 : 2, 'never exposes a partial plan');
      // No queued worker can continue writing after rejection: one atomic request only.
      assert.equal(state.create.mock.callCount(), 1);
      assert.equal(state.update.mock.callCount(), 0);
      await save();
      assert.equal((await load()).length, 2);
      assert.equal(state.items.size, 1);
      const writes = state.create.mock.callCount() + state.update.mock.callCount();
      await save();
      assert.equal(state.create.mock.callCount() + state.update.mock.callCount(), writes);
    });
  }
}

test('a visit arriving between snapshot read and planning CAS survives the retry', async (t) => {
  const state = setup(t);
  await saveDispo(DATE, DISPO, []);
  const existing = await getDispoRows(DATE);
  const version = getDispoVersion(existing);
  state.beforeWrite(() => setDispoVisited(existing[0], true, '17:12'));
  await saveDispo(DATE, [{ ...DISPO[0], team: 'B' }, DISPO[1]], existing);
  const rows = await getDispoRows(DATE);
  assert.equal(rows.find((row) => row.bookingId === '1')?.visitedAt, '17:12');
  assert.equal(rows.find((row) => row.bookingId === '1')?.team, 'B');
  assert.notEqual(getDispoVersion(rows), version);
  const plannedVersion = getDispoVersion(rows);
  await setDispoVisited(rows[0], false, '');
  assert.equal(getDispoVersion(await getDispoRows(DATE)), plannedVersion);
});

test('legacy Dispo is adopted whole with progress, snapshots replace legacy including empty plans', async (t) => {
  const state = setup(t);
  state.legacy.push({
    id: 'legacy',
    eTag: '"1"',
    fields: {
      Title: '1',
      Datum: DATE,
      Team: 'A',
      Reihenfolge: 1,
      SlotKey: DISPO[0].slotKey,
      GeplanteAnkunft: '17:00',
      Fixiert: true,
      Besucht: true,
      BesuchtUm: '17:12',
    },
  });
  const existing = await getDispoRows(DATE);
  await saveDispo(DATE, DISPO, existing);
  const rows = await getDispoRows(DATE);
  assert.equal(rows[0].id, 'legacy');
  assert.equal(rows[0].visitedAt, '17:12');
  await saveDispo(DATE, [], rows);
  assert.deepEqual(await getDispoRows(DATE), []);
  assert.deepEqual(await getAllDispoRows(), []);
});

test('Einteilung rename and delete apply to atomic snapshot; stale planning cannot restore them', async (t) => {
  setup(t);
  await saveEinteilung(EINTEILUNG, [], NAMES);
  const existing = await getEinteilungRows();
  const version = getEinteilungVersion(existing);
  assert.equal(getEinteilungVersion([...existing].reverse()), version);
  await renameInEinteilung('1', 'Neuer Name');
  assert.equal((await getEinteilungRows())[0].name, 'Neuer Name');
  assert.equal(getEinteilungVersion(await getEinteilungRows()), version);
  await deleteEinteilungOfPerson('1');
  await deleteEinteilungOfPerson('1');
  assert.deepEqual(
    (await getEinteilungRows()).map((row) => row.personId),
    ['2']
  );
  await assert.rejects(saveEinteilung(EINTEILUNG, existing, NAMES), { statusCode: 409 });
});

test('renaming a helper allows an existing plan to save with the current display name', async (t) => {
  setup(t);
  await saveEinteilung(EINTEILUNG, [], NAMES);
  const existing = await getEinteilungRows();
  const version = getEinteilungVersion(existing);
  await renameInEinteilung('1', 'Neuer Name');
  const names = new Map(NAMES).set('1', 'Neuer Name');
  await saveEinteilung([{ ...EINTEILUNG[0], team: 'B' }, EINTEILUNG[1]], existing, names, version);
  const saved = await getEinteilungRows();
  assert.equal(saved[0].name, 'Neuer Name');
  assert.equal(saved[0].team, 'B');
  assert.notEqual(getEinteilungVersion(saved), version);
});

test('corrupt planning state is rejected instead of exposing legacy rows or overwriting it', async (t) => {
  const state = setup(t);
  state.items.set('1', {
    id: '1',
    eTag: '"1"',
    fields: { OperationKey: `planning:dispo:${DATE}`, State: '{"schema":1,"rows":[{}]}' },
  });
  await assert.rejects(getDispoRows(DATE), /Invalid Nikolaus planning snapshot/);
  await assert.rejects(saveDispo(DATE, DISPO, []), /Invalid Nikolaus planning snapshot/);
  assert.equal(state.create.mock.callCount(), 0);
  assert.equal(state.update.mock.callCount(), 0);
});

test('endpoint-supplied stale Dispo version conflicts even when existing rows were freshly reloaded', async (t) => {
  const state = setup(t);
  const staleVersion = getDispoVersion([]);
  await saveDispo(DATE, DISPO, []);
  const freshlyLoaded = await getDispoRows(DATE);
  await assert.rejects(
    saveDispo(DATE, [{ ...DISPO[0], team: 'B' }, DISPO[1]], freshlyLoaded, staleVersion),
    { statusCode: 409 }
  );
  assert.equal(state.update.mock.callCount(), 0);
  assert.equal((await getDispoRows(DATE))[0].team, 'A');
});

test('endpoint-supplied stale Einteilung version conflicts even when existing rows were freshly reloaded', async (t) => {
  const state = setup(t);
  const staleVersion = getEinteilungVersion([]);
  await saveEinteilung(EINTEILUNG, [], NAMES);
  const freshlyLoaded = await getEinteilungRows();
  await assert.rejects(
    saveEinteilung(
      [{ ...EINTEILUNG[0], fixed: false }, EINTEILUNG[1]],
      freshlyLoaded,
      NAMES,
      staleVersion
    ),
    { statusCode: 409 }
  );
  assert.equal(state.update.mock.callCount(), 0);
  assert.equal((await getEinteilungRows())[0].fixed, true);
});

test('booking cleanup removes all-season snapshot rows before legacy cleanup and converges after interruption', async (t) => {
  const state = setup(t);
  const oldDate = '2025-12-05';
  await saveDispo(DATE, DISPO, []);
  await saveDispo(
    oldDate,
    DISPO.map((entry) => ({ ...entry, slotKey: entry.slotKey.replace(DATE, oldDate) })),
    []
  );
  state.legacy.push({
    id: 'old-legacy',
    eTag: '"legacy,1"',
    fields: { Title: '1', Datum: oldDate },
  });
  let failOnce = true;
  state.remove.mock.mockImplementation(async (list: string, id: string, etag?: string) => {
    assert.equal(list, CONFIG.sharepoint.lists.nikolausDispo);
    assert.equal(id, 'old-legacy');
    assert.equal(etag, '"legacy,1"');
    assert.ok((await getAllDispoRows()).every((row) => row.bookingId !== '1'));
    if (failOnce) {
      failOnce = false;
      throw new Error('simulated cleanup interruption');
    }
    state.legacy.splice(0, 1);
  });
  await assert.rejects(deleteDispoOfBooking('1'), /cleanup interruption/);
  assert.equal(state.legacy.length, 1);
  await deleteDispoOfBooking('1');
  await deleteDispoOfBooking('1');
  assert.equal(state.legacy.length, 0);
  assert.deepEqual(
    (await getAllDispoRows()).map((row) => row.bookingId),
    ['2', '2']
  );
});

test('helper cleanup removes authoritative and physical legacy references before parent deletion', async (t) => {
  const state = setup(t);
  await saveEinteilung(EINTEILUNG, [], NAMES);
  state.legacy.push({
    id: 'legacy-helper',
    eTag: '"legacy,1"',
    fields: { HelferId: 1, Datum: DATE, Title: 'Alter Name' },
  });
  state.remove.mock.mockImplementation(async (list: string, id: string, etag?: string) => {
    assert.equal(list, CONFIG.sharepoint.lists.nikolausEinteilung);
    assert.equal(id, 'legacy-helper');
    assert.equal(etag, '"legacy,1"');
    assert.deepEqual(
      (await getEinteilungRows()).map((row) => row.personId),
      ['2']
    );
    state.legacy.splice(0, 1);
  });
  await deleteEinteilungOfPerson('1');
  await deleteEinteilungOfPerson('1');
  assert.equal(state.legacy.length, 0);
  assert.equal(state.remove.mock.callCount(), 1);
});

for (const change of ['remove', 'unvisit', 'booking-cleanup'] as const) {
  test(`last actual visit survives ${change} before the first daily retention scan`, async (t) => {
    const state = setup(t);
    await saveDispo(DATE, DISPO, []);
    let rows = await getDispoRows(DATE);
    await setDispoVisited(rows[0], true, '2026-12-09T18:00:00Z');
    const sources = (): RetentionSources => ({
      booking: DISPO.map((entry) => ({
        id: entry.bookingId,
        eTag: '"booking,1"',
        fields: { SlotKey: entry.slotKey },
      })),
      dispo: [],
      helper: [],
      einteilung: [],
      states: [...state.items.values()].map((item) => ({
        id: item.id,
        etag: item.eTag,
        key: String(item.fields.OperationKey),
        data: JSON.parse(String(item.fields.State)) as unknown,
      })),
    });
    const now = new Date('2027-01-05T12:00:00Z');
    assert.equal(getNikolausRetentionSchedule(sources(), now).policies[0].deleteOn, '2027-01-09');
    rows = await getDispoRows(DATE);
    if (change === 'remove') await saveDispo(DATE, [DISPO[1]], rows);
    else if (change === 'unvisit') await setDispoVisited(rows[0], false, '');
    else await deleteDispoOfBooking('1');
    const schedule = getNikolausRetentionSchedule(sources(), now);
    assert.equal(schedule.policies[0].deleteOn, '2027-01-09');
    assert.deepEqual(schedule.duePolicies, []);
  });
}

for (const failure of ['before', 'after'] as const) {
  test(`visit metadata ${failure}-commit failure leaves progress unchanged and retry preserves the deadline`, async (t) => {
    const state = setup(t);
    await saveDispo(DATE, DISPO, []);
    const row = (await getDispoRows(DATE))[0];
    state.fail(failure);
    await assert.rejects(setDispoVisited(row, true, '2026-12-09T18:00:00Z'), /simulated/);
    assert.equal((await getDispoRows(DATE))[0].visited, false);
    await setDispoVisited(row, true, '2026-12-09T18:00:00Z');
    await setDispoVisited(row, false, '');
    const metadata = [...state.items.values()].find(
      (item) => item.fields.OperationKey === 'retention:schedule:2026'
    );
    assert.ok(metadata);
    assert.equal(JSON.parse(String(metadata.fields.State)).deleteOn, '2027-01-09');
  });
}

test('a crash between deadline preservation and visit progress only postpones cleanup', async (t) => {
  const state = setup(t);
  await saveDispo(DATE, DISPO, []);
  const row = (await getDispoRows(DATE))[0];
  state.beforeWrite(async () => {
    state.beforeWrite(async () => state.fail('before'));
  });
  await assert.rejects(setDispoVisited(row, true, '2026-12-09T18:00:00Z'), /simulated/);
  assert.equal((await getDispoRows(DATE))[0].visited, false);
  const metadata = [...state.items.values()].find(
    (item) => item.fields.OperationKey === 'retention:schedule:2026'
  );
  assert.ok(metadata);
  assert.equal(JSON.parse(String(metadata.fields.State)).deleteOn, '2027-01-09');
  await setDispoVisited(row, true, '2026-12-09T18:00:00Z');
  assert.equal((await getDispoRows(DATE))[0].visited, true);
});

test('concurrent first visit metadata writes retain the latest completion through CAS', async (t) => {
  const state = setup(t);
  await saveDispo(DATE, DISPO, []);
  const rows = await getDispoRows(DATE);
  await Promise.all([
    setDispoVisited(rows[0], true, '2026-12-12T18:00:00Z'),
    setDispoVisited(rows[1], true, '2026-12-09T18:00:00Z'),
  ]);
  await saveDispo(DATE, [], await getDispoRows(DATE));
  const policies = [...state.items.values()].filter(
    (item) => item.fields.OperationKey === 'retention:schedule:2026'
  );
  assert.equal(policies.length, 1);
  assert.equal(JSON.parse(String(policies[0].fields.State)).deleteOn, '2027-01-12');
});

test('legacy visit completion is preserved before an empty authoritative snapshot replaces it', async (t) => {
  const state = setup(t);
  state.legacy.push({
    id: 'legacy',
    eTag: '"legacy,1"',
    fields: {
      Title: '1',
      Datum: DATE,
      SlotKey: DISPO[0].slotKey,
      GeplanteAnkunft: '17:00',
      Besucht: true,
      BesuchtUm: '2026-12-09T18:00:00Z',
    },
  });
  state.fail('before');
  await assert.rejects(saveDispo(DATE, [], await getDispoRows(DATE)), /simulated/);
  assert.equal((await getDispoRows(DATE)).length, 1);
  await saveDispo(DATE, [], await getDispoRows(DATE));
  assert.deepEqual(await getDispoRows(DATE), []);
  const metadata = [...state.items.values()].find(
    (item) => item.fields.OperationKey === 'retention:schedule:2026'
  );
  assert.ok(metadata);
  assert.equal(JSON.parse(String(metadata.fields.State)).deleteOn, '2027-01-09');
});
