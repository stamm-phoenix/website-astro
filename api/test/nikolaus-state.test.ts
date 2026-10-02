import assert from 'node:assert/strict';
import test from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import {
  deleteNikolausState,
  InvalidNikolausStateError,
  listNikolausStates,
  mutateNikolausState,
  NikolausStateConflictError,
  NikolausStateSizeError,
  readNikolausState,
} from '../lib/nikolaus-state';
import { setupSharedState } from './fixtures/shared-state';

function counter(value: unknown): number {
  if (value === undefined) return 0;
  assert.equal(typeof value, 'number');
  return Number(value);
}

test('unique state creation and CAS retries preserve concurrent updates', async (t) => {
  const state = setupSharedState(t);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => mutateNikolausState('counter', counter, (value) => value + 1))
  );
  assert.deepEqual(results.slice().sort(), [1, 2, 3, 4, 5]);
  assert.equal((await readNikolausState('counter'))?.data, 5);
  assert.equal(state.rows.size, 1);
});

for (const statusCode of [400, 409, 503]) {
  test(`unconfirmed create failure ${statusCode} is not retried`, async (t) => {
    setupSharedState(t);
    const failure = Object.assign(new Error('Create failed without a competing row'), {
      statusCode,
    });
    const create = t.mock.method(sharePoint, 'createSharePointListItem', async () => {
      throw failure;
    });
    await assert.rejects(
      mutateNikolausState('counter', counter, (value) => value + 1),
      (error: unknown) => error === failure
    );
    assert.equal(create.mock.callCount(), 1);
  });
}

test('unchanged state is a no-op and deletes cannot erase newer writes', async (t) => {
  const state = setupSharedState(t);
  await mutateNikolausState('counter', counter, (value) => value + 1);
  const original = await readNikolausState('counter');
  assert.ok(original);
  await mutateNikolausState('counter', counter, (value) => value);
  assert.equal(state.writes.updates, 0);
  await mutateNikolausState('counter', counter, (value) => value + 1);
  await assert.rejects(deleteNikolausState(original), NikolausStateConflictError);
  const current = await readNikolausState('counter');
  assert.ok(current);
  await deleteNikolausState(current);
  await deleteNikolausState(current);
  assert.equal(state.rows.size, 0);
});

test('contention is bounded and corrupted or duplicate state fails closed', async (t) => {
  const state = setupSharedState(t);
  const row = state.seed('counter', 1);
  t.mock.method(sharePoint, 'updateSharePointListItem', async () => {
    throw Object.assign(new Error('Always stale'), { statusCode: 412 });
  });
  await assert.rejects(
    mutateNikolausState('counter', counter, (value) => value + 1),
    NikolausStateConflictError
  );
  row.fields.State = 'invalid JSON';
  await assert.rejects(readNikolausState('counter'), InvalidNikolausStateError);
  row.fields.State = '1';
  state.seed('counter', 2);
  await assert.rejects(readNikolausState('counter'), InvalidNikolausStateError);
});

test('large snapshots round-trip compressed and oversized writes leave existing state intact', async (t) => {
  const state = setupSharedState(t);
  const data = {
    rows: Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      date: '2026-12-05',
      name: `Testperson ${i}`,
      role: 'Nikolaus',
      fixed: false,
    })),
  };
  await mutateNikolausState(
    'planning:test',
    () => data,
    (value) => value
  );
  assert.ok(String([...state.rows.values()][0].fields.State).includes('nikolaus-state-gzip-v1'));
  assert.deepEqual((await readNikolausState('planning:test'))?.data, data);
  await assert.rejects(
    mutateNikolausState(
      'planning:test',
      () => 'x'.repeat(1_000_001),
      (value) => value
    ),
    NikolausStateSizeError
  );
  assert.deepEqual((await readNikolausState('planning:test'))?.data, data);
  assert.equal((await listNikolausStates('planning:')).length, 1);
});

test('unrelated corrupt state does not hide valid plans, but selected corruption still fails', async (t) => {
  const state = setupSharedState(t);
  const plan = state.seed('planning:dispo:2026-12-05', { rows: [] });
  const unrelated = state.seed('geocoding:nominatim', {});
  unrelated.fields.State = 'invalid JSON';
  assert.equal((await listNikolausStates('planning:dispo:'))[0].id, plan.id);
  plan.fields.State = 'invalid JSON';
  await assert.rejects(listNikolausStates('planning:dispo:'), InvalidNikolausStateError);
  await assert.rejects(listNikolausStates(''), InvalidNikolausStateError);
});
