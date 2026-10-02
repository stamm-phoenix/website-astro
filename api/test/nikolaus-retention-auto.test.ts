import assert from 'node:assert/strict';
import test from 'node:test';
import { runAutomaticNikolausRetention } from '../lib/nikolaus-retention-auto';
import type { AutomaticRetentionDependencies } from '../lib/nikolaus-retention-auto';
import { retentionDigest } from '../lib/nikolaus-retention';
import type { RetentionSources } from '../lib/nikolaus-retention';
import {
  mergeRetentionSeasonPolicy,
  retentionScheduleKey,
} from '../lib/nikolaus-retention-schedule';

const NOW = new Date('2027-01-06T04:00:00Z');
const TARGET = retentionDigest('simulated production site');

function simulation(): {
  dependencies: AutomaticRetentionDependencies;
  state: RetentionSources;
  events: string[];
} {
  const state: RetentionSources = {
    booking: [
      {
        id: 'old',
        eTag: '"1"',
        fields: {
          SlotKey: '2026-12-06T17:00',
          Title: 'Private family',
          Email: 'private@example.invalid',
        },
      },
      { id: 'future', eTag: '"1"', fields: { SlotKey: '2027-12-06T17:00' } },
    ],
    dispo: [{ id: 'route', eTag: '"1"', fields: { Title: 'old', Datum: '2026-12-06' } }],
    helper: [],
    einteilung: [],
    states: [],
  };
  const events: string[] = [];
  const dependencies: AutomaticRetentionDependencies = {
    targetDigest: TARGET,
    expectedTargetDigest: TARGET,
    backend: {
      load: async () => structuredClone(state),
      delete: async (operation) => {
        events.push(`delete:${operation.kind}:${operation.id}`);
        assert.ok(events.some((event) => event.startsWith('verified:')));
        if (operation.kind === 'state-delete') {
          state.states = state.states.filter((entry) => entry.id !== operation.id);
        } else if (operation.kind !== 'state-update') {
          const rows = state[operation.kind] as { id: string; eTag: string }[];
          const row = rows.find((entry) => entry.id === operation.id);
          if (row && row.eTag !== operation.etag)
            throw Object.assign(new Error('Conflict'), { statusCode: 412 });
          state[operation.kind] = rows.filter((entry) => entry.id !== operation.id);
        }
      },
      updateState: async () => {
        throw new Error('Unexpected state update');
      },
    },
    beginMaintenance: async (owner) => {
      events.push(`begin:${owner}`);
      return { ready: true, activeWriters: [] };
    },
    endMaintenance: async (owner) => {
      events.push(`end:${owner}`);
    },
    verifyDeployment: async (owner) => {
      events.push(`verified:${owner}`);
    },
    savePolicy: async (policy) => {
      events.push(`policy:${policy.season}`);
      const key = retentionScheduleKey(policy.season);
      const stored = state.states.find((entry) => entry.key === key);
      const data = mergeRetentionSeasonPolicy(stored?.data, policy);
      if (stored) stored.data = data;
      else state.states.push({ id: key, key, etag: '"1"', data });
    },
    saveRun: async (_season, report) => {
      const serialized = JSON.stringify(report);
      assert.ok(!serialized.includes('Private family'));
      assert.ok(!serialized.includes('private@example.invalid'));
      events.push('report');
    },
  };
  return { dependencies, state, events };
}

test('daily cleanup waits for the Berlin month boundary and preview never claims or writes', async () => {
  const { dependencies, events, state } = simulation();
  const preview = await runAutomaticNikolausRetention(dependencies, { dryRun: true, now: NOW });
  assert.equal(preview.status, 'preview');
  assert.deepEqual(preview.dueSeasons, [2026]);
  assert.equal(preview.plans[0].options.responsibleRole, 'Nico Welles');
  assert.equal(events.length, 0);
  assert.equal(state.booking.length, 2);
  const early = await runAutomaticNikolausRetention(dependencies, {
    dryRun: false,
    now: new Date('2027-01-05T22:59:59Z'),
  });
  assert.equal(early.status, 'idle');
  assert.ok(events.every((event) => event.startsWith('policy:')));
});

test('automatic cleanup persists reports, deletes dependents first and repeats without affecting next season', async () => {
  const { dependencies, events, state } = simulation();
  const first = await runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW });
  assert.equal(first.status, 'complete');
  assert.deepEqual(
    events.filter((event) => event.startsWith('delete:')),
    ['delete:dispo:route', 'delete:booking:old']
  );
  assert.equal(events.at(-1)?.split(':')[0], 'end');
  assert.equal(state.booking.length, 1);
  events.length = 0;
  const repeated = await runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW });
  assert.equal(repeated.status, 'idle');
  assert.ok(events.every((event) => event.startsWith('policy:')));
});

test('active writers and failed deployment verification prevent all deletion and release only their own claim', async () => {
  const busy = simulation();
  busy.dependencies.beginMaintenance = async (owner) => {
    busy.events.push(`begin:${owner}`);
    return { ready: false, activeWriters: [{ id: 'paused', startedAt: NOW.toISOString() }] };
  };
  assert.equal(
    (await runAutomaticNikolausRetention(busy.dependencies, { dryRun: false, now: NOW })).status,
    'busy'
  );
  assert.ok(
    !busy.events.some((event) => event.startsWith('delete:') || event.startsWith('verified:'))
  );
  assert.equal(busy.events.at(-1)?.split(':')[0], 'end');
  const invalid = simulation();
  invalid.dependencies.verifyDeployment = async () => {
    throw new Error('Old preview');
  };
  await assert.rejects(
    runAutomaticNikolausRetention(invalid.dependencies, { dryRun: false, now: NOW }),
    /Old preview/
  );
  assert.equal(invalid.state.booking.length, 2);
  assert.equal(invalid.events.at(-1)?.split(':')[0], 'end');
});

test('a writer completing before maintenance can postpone the deadline after the initial scan', async () => {
  const { dependencies, state, events } = simulation();
  dependencies.beginMaintenance = async (owner) => {
    events.push(`begin:${owner}`);
    state.dispo.push({
      id: 'late',
      eTag: '"1"',
      fields: {
        Title: 'old',
        Datum: '2026-12-06',
        Besucht: true,
        BesuchtUm: '2026-12-09T19:00:00Z',
      },
    });
    return { ready: true, activeWriters: [] };
  };
  const result = await runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW });
  assert.equal(result.status, 'idle');
  assert.deepEqual(result.dueSeasons, []);
  assert.ok(!events.some((event) => event.startsWith('delete:')));
});

test('failure to persist a progress report stops before the parent deletion and next run recovers', async () => {
  const { dependencies, state, events } = simulation();
  const original = dependencies.saveRun;
  let saves = 0;
  dependencies.saveRun = async () => {
    if (++saves === 2) throw new Error('Report store unavailable');
  };
  await assert.rejects(
    runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW }),
    /Report store/
  );
  assert.equal(state.dispo.length, 0);
  assert.equal(state.booking.length, 2);
  assert.equal(events.at(-1)?.split(':')[0], 'end');
  dependencies.saveRun = original;
  const recovered = await runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW });
  assert.equal(recovered.status, 'complete');
  assert.equal(state.booking.length, 1);
});

test('an unapproved target cannot even read data', async () => {
  const { dependencies } = simulation();
  dependencies.expectedTargetDigest = retentionDigest('another site');
  dependencies.backend.load = async () => {
    assert.fail('Must not read');
  };
  await assert.rejects(
    runAutomaticNikolausRetention(dependencies, { dryRun: false, now: NOW }),
    /target/
  );
});
