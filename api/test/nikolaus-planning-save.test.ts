import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as environment from '../lib/environment';
import { getDispoRows, getDispoVersion, saveDispo } from '../lib/nikolaus-dispo-list';
import type { DispoEntry } from '../lib/nikolaus-dispo-list';
import {
  getEinteilungRows,
  getEinteilungVersion,
  saveEinteilung,
} from '../lib/nikolaus-einteilung-list';
import type { EinteilungSaveInput } from '../lib/pflege-validation';

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

function setup(t: TestContext) {
  t.mock.method(environment, 'getEnvironment', () => 'simulated-planning');
  const rows = new Map<string, StoredItem>();
  let nextId = 1;
  let failSecond = true;
  t.mock.method(sharePoint, 'getSharePointListItems', async () =>
    structuredClone([...rows.values()])
  );
  const create = t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (_list: string, fields: Record<string, unknown>) => {
      if (failSecond && (fields.Title === '2' || fields.HelferId === 2)) {
        throw new Error('simulated second-row create failure');
      }
      const id = String(nextId++);
      rows.set(id, { id, eTag: `"${id},1"`, fields: structuredClone(fields) });
      return id;
    }
  );
  const update = t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (_list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const row = rows.get(id);
      assert.ok(row);
      assert.equal(etag, row.eTag);
      Object.assign(row.fields, fields);
      row.eTag = `"${id},2"`;
    }
  );
  const remove = t.mock.method(
    sharePoint,
    'deleteSharePointListItem',
    async (_list: string, id: string, etag?: string) => {
      assert.equal(etag, rows.get(id)?.eTag);
      rows.delete(id);
    }
  );
  return {
    rows,
    create,
    update,
    remove,
    allowRetry: () => {
      failSecond = false;
    },
  };
}

test('Dispo reload and retry after a partial create failure retain existing visits without duplicates', async (t) => {
  const state = setup(t);
  await assert.rejects(saveDispo(DATE, DISPO, []), /simulated second-row create failure/);
  assert.equal(state.rows.size, 1);
  const partial = await getDispoRows(DATE);
  assert.equal(partial[0].bookingId, '1');
  state.allowRetry();
  await saveDispo(DATE, DISPO, partial);
  const saved = await getDispoRows(DATE);
  assert.deepEqual(
    saved.map((row) => row.bookingId),
    ['1', '2']
  );
  assert.equal(saved[0].id, partial[0].id);
  assert.equal(saved[0].fixed, true);
  assert.equal(state.create.mock.callCount(), 3);
  await saveDispo(DATE, DISPO, saved);
  assert.equal(state.create.mock.callCount(), 3);
  assert.equal(state.update.mock.callCount(), 0);
  assert.equal(state.remove.mock.callCount(), 0);
});

test('Einteilung reload and retry after a partial create failure keep each helper once per day', async (t) => {
  const state = setup(t);
  await assert.rejects(
    saveEinteilung(EINTEILUNG, [], NAMES),
    /simulated second-row create failure/
  );
  assert.equal(state.rows.size, 1);
  const partial = await getEinteilungRows();
  state.allowRetry();
  await saveEinteilung(EINTEILUNG, partial, NAMES);
  const saved = await getEinteilungRows();
  assert.deepEqual(
    saved.map((row) => [row.personId, row.date]),
    [
      ['1', DATE],
      ['2', DATE],
    ]
  );
  assert.equal(saved[0].id, partial[0].id);
  assert.equal(saved[0].fixed, true);
  assert.equal(saved[0].name, NAMES.get('1'));
  assert.equal(state.create.mock.callCount(), 3);
  await saveEinteilung(EINTEILUNG, saved, NAMES);
  assert.equal(state.create.mock.callCount(), 3);
  assert.equal(state.update.mock.callCount(), 0);
  assert.equal(state.remove.mock.callCount(), 0);
});

test('Dispo planning updates preserve visit progress and ignore progress in the planning version', async (t) => {
  const state = setup(t);
  state.allowRetry();
  await saveDispo(DATE, DISPO, []);
  const visited = state.rows.get('1');
  assert.ok(visited);
  const version = getDispoVersion(await getDispoRows(DATE));
  visited.fields.Besucht = true;
  visited.fields.BesuchtUm = '17:12';
  visited.eTag = '"1,progress"';
  const existing = await getDispoRows(DATE);
  assert.equal(getDispoVersion(existing), version);
  await saveDispo(DATE, [{ ...DISPO[0], team: 'B' }, DISPO[1]], existing);
  assert.equal(visited.fields.Besucht, true);
  assert.equal(visited.fields.BesuchtUm, '17:12');
  assert.equal(visited.fields.Team, 'B');
  assert.notEqual(getDispoVersion(await getDispoRows(DATE)), version);
  assert.equal(state.update.mock.calls[0].arguments[3], '"1,progress"');
});

test('Einteilung version is order independent and changes with a saved row version', async (t) => {
  const state = setup(t);
  state.allowRetry();
  await saveEinteilung(EINTEILUNG, [], NAMES);
  const rows = await getEinteilungRows();
  const version = getEinteilungVersion(rows);
  assert.equal(getEinteilungVersion([...rows].reverse()), version);
  await saveEinteilung([{ ...EINTEILUNG[0], fixed: false }, EINTEILUNG[1]], rows, NAMES);
  assert.notEqual(getEinteilungVersion(await getEinteilungRows()), version);
  assert.equal(state.update.mock.calls[0].arguments[3], rows[0].etag);
});
