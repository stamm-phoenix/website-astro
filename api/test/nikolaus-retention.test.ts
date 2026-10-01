import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyNikolausRetention,
  parseRetentionPlan,
  planNikolausRetention,
  retentionDigest,
  type RetentionBackend,
  type RetentionOperation,
  type RetentionOptions,
  type RetentionSources,
} from '../lib/nikolaus-retention';

const NOW = new Date('2026-10-01T12:00:00Z');
const TARGET = retentionDigest('test-site-and-lists');
const OPTIONS: RetentionOptions = {
  season: 2025,
  before: '2026-01-01',
  responsibleRole: 'Nikolauskoordination',
};

function row(id: string, fields: Record<string, unknown>): unknown {
  return { id, eTag: `"${id},1"`, fields };
}

function sources(): RetentionSources {
  return {
    booking: [
      row('b-old', {
        Title: 'Private family name',
        Email: 'private@example.invalid',
        SlotKey: '2025-12-06T17:00',
      }),
      row('b-new', { SlotKey: '2026-12-06T17:00' }),
    ],
    dispo: [
      row('d-old', { Title: 'b-old', Datum: '2025-12-06' }),
      row('d-new', { Title: 'b-new', Datum: '2026-12-06' }),
    ],
    helper: [
      row('h-old', { Title: 'Private helper name', Verfuegbarkeit: '{"2025-12-06":["Nikolaus"]}' }),
      row('h-new', { Verfuegbarkeit: '{"2026-12-06":["Nikolaus"]}' }),
    ],
    einteilung: [
      row('e-old', { HelferId: 'h-old', Datum: '2025-12-06' }),
      row('e-new', { HelferId: 'h-new', Datum: '2026-12-06' }),
    ],
    states: [
      {
        id: 's-dispo-old',
        etag: '"s1"',
        key: 'planning:dispo:2025-12-06',
        data: {
          schema: 1,
          rows: [{ bookingId: 'b-old', date: '2025-12-06', name: 'Private family name' }],
        },
      },
      {
        id: 's-dispo-new',
        etag: '"s2"',
        key: 'planning:dispo:2026-12-06',
        data: { schema: 1, rows: [{ bookingId: 'b-new', date: '2026-12-06' }] },
      },
      {
        id: 's-einteilung',
        etag: '"s3"',
        key: 'planning:einteilung',
        data: {
          schema: 1,
          rows: [
            { personId: 'h-old', name: 'Private helper name', date: '2025-12-06' },
            { personId: 'h-new', date: '2026-12-06' },
          ],
        },
      },
      {
        id: 's-geocoding',
        etag: '"s4"',
        key: 'geocoding:nominatim',
        data: {
          version: 1,
          nextRequestAt: 1234,
          cache: [
            {
              key: 'address-hmac',
              expires: NOW.getTime() + 100_000,
              result: { found: true, precision: 'address', lat: 47.9, lon: 11.8 },
            },
          ],
        },
      },
    ],
  };
}

function memoryBackend(initial: RetentionSources): {
  backend: RetentionBackend;
  operations: string[];
  state: RetentionSources;
} {
  const state = structuredClone(initial);
  const operations: string[] = [];
  const missing = (): never => {
    throw Object.assign(new Error('Already deleted'), { statusCode: 404 });
  };
  const conflict = (): never => {
    throw Object.assign(new Error('Modified'), { statusCode: 412 });
  };
  return {
    state,
    operations,
    backend: {
      load: async () => structuredClone(state),
      delete: async (operation) => {
        operations.push(`${operation.kind}:${operation.id}`);
        if (operation.kind === 'state-delete') {
          const index = state.states.findIndex((entry) => entry.id === operation.id);
          if (index < 0) missing();
          if (state.states[index].etag !== operation.etag) conflict();
          state.states.splice(index, 1);
        } else if (operation.kind !== 'state-update') {
          const rows = state[operation.kind] as { id: string; eTag: string }[];
          const index = rows.findIndex((entry) => entry.id === operation.id);
          if (index < 0) missing();
          if (rows[index].eTag !== operation.etag) conflict();
          rows.splice(index, 1);
        }
      },
      updateState: async (operation, data) => {
        operations.push(`${operation.kind}:${operation.id}`);
        const entry = state.states.find((item) => item.id === operation.id);
        if (!entry) return missing();
        if (entry.etag !== operation.etag) conflict();
        entry.data = data;
        entry.etag += '-changed';
      },
      sleep: async () => undefined,
    },
  };
}

test('preview includes dependent legacy rows, authoritative snapshots and geocoding cache without family data', () => {
  const plan = planNikolausRetention(sources(), OPTIONS, TARGET, NOW);
  assert.deepEqual(
    plan.operations.map((operation) => `${operation.kind}:${operation.id}`),
    [
      'dispo:d-old',
      'einteilung:e-old',
      'state-delete:s-dispo-old',
      'state-update:s-einteilung',
      'state-update:s-geocoding',
      'booking:b-old',
      'helper:h-old',
    ]
  );
  assert.equal(plan.retained.length, 0);
  assert.equal(JSON.stringify(plan).includes('Private'), false);
  assert.equal(JSON.stringify(plan).includes('private@example'), false);
  assert.equal(JSON.stringify(plan).includes('47.9'), false);
  assert.deepEqual(parseRetentionPlan(JSON.parse(JSON.stringify(plan))), plan);
});

test('apply deletes dependents first and a repeated apply converges without deleting the next season', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend, state, operations } = memoryBackend(original);
  const first = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(first.complete, true);
  assert.ok(operations.indexOf('state-delete:s-dispo-old') < operations.indexOf('booking:b-old'));
  assert.ok(operations.indexOf('state-update:s-einteilung') < operations.indexOf('helper:h-old'));
  assert.deepEqual(state.booking, [original.booking[1]]);
  assert.deepEqual(state.helper, [original.helper[1]]);
  assert.deepEqual(state.states.find((entry) => entry.id === 's-geocoding')?.data, {
    version: 1,
    nextRequestAt: 1234,
    cache: [],
  });
  const repeated = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(repeated.complete, true);
  assert.ok(
    repeated.results.every((result) =>
      ['already_absent', 'already_updated'].includes(result.status)
    )
  );
});

test('an interrupted run can resume the exact reviewed plan', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend } = memoryBackend(original);
  const remove = backend.delete;
  let fail = true;
  backend.delete = async (operation) => {
    if (operation.kind === 'booking' && fail)
      throw Object.assign(new Error('Conflict'), { statusCode: 412 });
    await remove(operation);
  };
  const partial = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(partial.complete, false);
  assert.equal(partial.results.find((entry) => entry.kind === 'booking')?.errorCode, 412);
  assert.equal(partial.results.find((entry) => entry.kind === 'helper')?.status, 'skipped');
  fail = false;
  const resumed = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(resumed.complete, true);
});

test('a dependent-row conflict stops before deleting its parent and writes a partial report', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend, state } = memoryBackend(original);
  const reports: unknown[] = [];
  backend.delete = async () => {
    throw Object.assign(new Error('Changed'), { statusCode: 412 });
  };
  backend.report = (value) => reports.push(structuredClone(value));
  const result = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(result.complete, false);
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].attempts, 1);
  assert.ok(result.results.slice(1).every((entry) => entry.status === 'skipped'));
  assert.deepEqual(state.booking, original.booking);
  assert.ok(reports.length > 0);
});

test('new rows, modified ETags and another target invalidate a saved preview before any deletion', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  for (const change of [
    (state: RetentionSources) =>
      state.dispo.push(row('d-added', { Title: 'b-old', Datum: '2025-12-06' })),
    (state: RetentionSources) => {
      (state.booking[0] as { eTag: string }).eTag = 'changed';
    },
  ]) {
    const { backend, state, operations } = memoryBackend(original);
    change(state);
    await assert.rejects(() => applyNikolausRetention(plan, TARGET, backend, NOW));
    assert.deepEqual(operations, []);
  }
  const { backend, operations } = memoryBackend(original);
  await assert.rejects(() =>
    applyNikolausRetention(plan, retentionDigest('another-site'), backend, NOW)
  );
  assert.deepEqual(operations, []);
});

test('a newly recreated dependent row prevents its parent deletion during apply', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend, state } = memoryBackend(original);
  const update = backend.updateState;
  backend.updateState = async (operation, data) => {
    await update(operation, data);
    if (operation.id === 's-geocoding')
      state.dispo.push(row('d-race', { Title: 'b-old', Datum: '2025-12-06' }));
  };
  const result = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(result.complete, false);
  assert.equal(result.results.find((entry) => entry.kind === 'booking')?.errorCode, 'DEPENDENCY');
  assert.equal(state.booking.length, 2);
});

test('mixed-season helper availability and outside-season dependencies are retained explicitly', () => {
  const original = sources();
  (original.helper[0] as { fields: Record<string, unknown> }).fields.Verfuegbarkeit =
    '{"2025-12-06":[],"2026-12-06":[]}';
  original.dispo.push(row('d-cross', { Title: 'b-old', Datum: '2026-12-06' }));
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  assert.deepEqual(plan.retained, [
    { kind: 'booking', id: 'b-old', reason: 'dependent_dispo_outside_cutoff' },
    { kind: 'helper', id: 'h-old', reason: 'availability_outside_cutoff' },
  ]);
  assert.ok(
    !plan.operations.some(
      (operation) => operation.kind === 'booking' || operation.kind === 'helper'
    )
  );
});

test('transient throttling is retried, while future cutoffs and damaged previews fail before writes', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend } = memoryBackend(original);
  const remove = backend.delete;
  let attempts = 0;
  backend.delete = async (operation: RetentionOperation) => {
    if (operation.kind === 'dispo' && attempts++ === 0)
      throw Object.assign(new Error('Throttled'), { statusCode: 429 });
    await remove(operation);
  };
  const report = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(report.complete, true);
  assert.equal(report.results[0].attempts, 2);
  const future = planNikolausRetention(original, { ...OPTIONS, before: '2027-01-01' }, TARGET, NOW);
  await assert.rejects(() => applyNikolausRetention(future, TARGET, backend, NOW), /future/);
  assert.throws(() => parseRetentionPlan({ ...plan, digest: 'tampered' }), /digest/);
});

test('missing ETags, impossible dates and an active geocoding lease cannot authorize cleanup', () => {
  const original = sources();
  (original.booking[0] as { eTag: string }).eTag = '';
  assert.throws(() => planNikolausRetention(original, OPTIONS, TARGET, NOW), /ETags/);
  assert.throws(() =>
    planNikolausRetention(sources(), { ...OPTIONS, before: '2026-02-30' }, TARGET, NOW)
  );
  const active = sources();
  (
    active.states.find((entry) => entry.id === 's-geocoding')?.data as Record<string, unknown>
  ).lease = {
    owner: 'running',
    key: 'address-hmac',
    expires: NOW.getTime() + 5_000,
  };
  assert.throws(() => planNikolausRetention(active, OPTIONS, TARGET, NOW), /active geocoding/);
});

test('a verification outage leaves a checkable incomplete report after successful writes', async () => {
  const original = sources();
  const plan = planNikolausRetention(original, OPTIONS, TARGET, NOW);
  const { backend } = memoryBackend(original);
  const load = backend.load;
  let loads = 0;
  backend.load = async () => {
    if (++loads === 4) throw Object.assign(new Error('Service unavailable'), { statusCode: 503 });
    return load();
  };
  const report = await applyNikolausRetention(plan, TARGET, backend, NOW);
  assert.equal(report.complete, false);
  assert.equal(report.verificationErrorCode, 503);
  assert.ok(report.results.every((result) => ['updated', 'deleted'].includes(result.status)));
});
