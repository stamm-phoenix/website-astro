import assert from 'node:assert/strict';
import test from 'node:test';
import * as sharePoint from '../lib/sharepoint-data-access';
import * as environment from '../lib/environment';
import { setupSharedState } from './fixtures/shared-state';
import {
  beginNikolausMaintenance,
  endNikolausMaintenance,
  NIKOLAUS_WRITE_GATE_KEY,
  NikolausMaintenanceError,
  readNikolausWriteGate,
  recoverStoppedNikolausWriters,
  runWithNikolausWriteGate,
} from '../lib/nikolaus-write-gate';

const OWNER = 'retention-run-1';

for (const enabled of [undefined, 'false', 'TRUE', '1', ' true', '']) {
  test(`writer opt-in ${String(enabled)} denies admission without reading or changing shared state`, async (t) => {
    const state = setupSharedState(t);
    if (enabled === undefined) delete process.env.NIKOLAUS_WRITES_ENABLED;
    else process.env.NIKOLAUS_WRITES_ENABLED = enabled;
    const read = t.mock.method(sharePoint, 'getSharePointListItems', async () => {
      throw new Error('Disabled writer must not access state, including finally');
    });
    await assert.rejects(
      runWithNikolausWriteGate(async () => assert.fail('Disabled writer must not run')),
      (error: unknown) => {
        assert.ok(error instanceof NikolausMaintenanceError);
        assert.equal(error.statusCode, 503);
        assert.equal(error.maintenanceOwner, undefined);
        return true;
      }
    );
    assert.equal(read.mock.callCount(), 0);
    assert.deepEqual(state.writes, { creates: 0, updates: 0, deletes: 0 });
  });
}

test('operator maintenance and status remain available while writes are disabled', async (t) => {
  setupSharedState(t);
  delete process.env.NIKOLAUS_WRITES_ENABLED;
  assert.deepEqual(await readNikolausWriteGate(), { schema: 1, writers: [] });
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, true);
  assert.equal((await readNikolausWriteGate()).maintenance?.owner, OWNER);
  await endNikolausMaintenance(OWNER);
  assert.equal((await readNikolausWriteGate()).maintenance, undefined);
});

function barrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('registered writers finish before maintenance becomes ready, and new writers are blocked', async (t) => {
  setupSharedState(t);
  const entered = barrier();
  const finish = barrier();
  const writing = runWithNikolausWriteGate(async () => {
    entered.release();
    await finish.promise;
    return 'saved';
  });
  await entered.promise;
  const maintenance = await beginNikolausMaintenance(OWNER);
  assert.equal(maintenance.ready, false);
  assert.equal(maintenance.activeWriters.length, 1);
  let rejectedWriterRan = false;
  await assert.rejects(
    runWithNikolausWriteGate(async () => {
      rejectedWriterRan = true;
    }),
    NikolausMaintenanceError
  );
  assert.equal(rejectedWriterRan, false);
  finish.release();
  assert.equal(await writing, 'saved');
  assert.deepEqual(await beginNikolausMaintenance(OWNER), { ready: true, activeWriters: [] });
  await endNikolausMaintenance(OWNER);
  assert.equal(await runWithNikolausWriteGate(async () => 'next writer'), 'next writer');
});

test('concurrent first admission and maintenance claim cannot allow a writer alongside ready retention', async (t) => {
  setupSharedState(t);
  const finish = barrier();
  let entered = false;
  const writing = runWithNikolausWriteGate(async () => {
    entered = true;
    await finish.promise;
  });
  const outcome = writing.then(
    () => 'completed',
    (error: unknown) => {
      assert.ok(error instanceof NikolausMaintenanceError);
      return 'denied';
    }
  );
  const maintenance = await beginNikolausMaintenance(OWNER);
  if (maintenance.ready) assert.equal(entered, false);
  else assert.equal(maintenance.activeWriters.length, 1);
  finish.release();
  assert.equal(await outcome, maintenance.ready ? 'denied' : 'completed');
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, true);
});

test('concurrent writers retain all registrations through CAS retries and release only themselves', async (t) => {
  setupSharedState(t);
  const finish = barrier();
  let entered = 0;
  const allEntered = barrier();
  const writers = Array.from({ length: 4 }, () =>
    runWithNikolausWriteGate(async () => {
      if (++entered === 4) allEntered.release();
      await finish.promise;
    })
  );
  await allEntered.promise;
  assert.equal((await readNikolausWriteGate()).writers.length, 4);
  assert.equal((await beginNikolausMaintenance(OWNER)).activeWriters.length, 4);
  finish.release();
  await Promise.all(writers);
  assert.deepEqual((await readNikolausWriteGate()).writers, []);
  assert.equal((await readNikolausWriteGate()).maintenance?.owner, OWNER);
});

test('release survives prolonged contention and preserves other owners', async (t) => {
  setupSharedState(t);
  let conflicts = 0;
  await runWithNikolausWriteGate(async () => {
    await beginNikolausMaintenance(OWNER);
    const update = sharePoint.updateSharePointListItem;
    t.mock.method(
      sharePoint,
      'updateSharePointListItem',
      async (...args: Parameters<typeof update>) => {
        if (++conflicts <= 8)
          throw Object.assign(new Error('Contended release'), { statusCode: 412 });
        return update(...args);
      }
    );
  });
  assert.equal(conflicts, 9);
  const state = await readNikolausWriteGate();
  assert.deepEqual(state.writers, []);
  assert.equal(state.maintenance?.owner, OWNER);
});

test('handler errors release the writer registration without clearing maintenance ownership', async (t) => {
  setupSharedState(t);
  const failure = new Error('simulated handler failure');
  await assert.rejects(
    runWithNikolausWriteGate(async () => {
      assert.equal((await beginNikolausMaintenance(OWNER)).ready, false);
      throw failure;
    }),
    (error: unknown) => error === failure
  );
  const state = await readNikolausWriteGate();
  assert.equal(state.writers.length, 0);
  assert.equal(state.maintenance?.owner, OWNER);
});

test('paused writers and crashed maintenance owners never expire; recovery requires the same owner', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, {
    schema: 1,
    writers: [{ id: 'paused-process', startedAt: '2000-01-01T00:00:00Z' }],
    maintenance: { owner: OWNER, startedAt: '2000-01-01T00:00:00Z' },
  });
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, false);
  await assert.rejects(beginNikolausMaintenance('different-owner'), NikolausMaintenanceError);
  await assert.rejects(endNikolausMaintenance('different-owner'), NikolausMaintenanceError);
  await assert.rejects(
    recoverStoppedNikolausWriters(OWNER, ['paused-process'], {
      confirmedStopped: false,
    } as unknown as { confirmedStopped: true }),
    NikolausMaintenanceError
  );
  await assert.rejects(
    recoverStoppedNikolausWriters('different-owner', ['paused-process'], {
      confirmedStopped: true,
    }),
    NikolausMaintenanceError
  );
  assert.equal((await readNikolausWriteGate()).writers.length, 1);
  await recoverStoppedNikolausWriters(OWNER, ['paused-process'], { confirmedStopped: true });
  await recoverStoppedNikolausWriters(OWNER, ['paused-process'], { confirmedStopped: true });
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, true);
  await endNikolausMaintenance(OWNER);
  await endNikolausMaintenance(OWNER);
});

test('a release failure retains the writer and blocks deletion until verified operator recovery', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, { schema: 1, writers: [] });
  const update = sharePoint.updateSharePointListItem;
  t.mock.method(
    sharePoint,
    'updateSharePointListItem',
    async (list: string, id: string, fields: Record<string, unknown>, etag?: string) => {
      const data = JSON.parse(String(fields.State)) as { writers: unknown[] };
      if (data.writers.length === 0) throw new Error('simulated release outage');
      return update(list, id, fields, etag);
    }
  );
  let saved = false;
  await assert.rejects(
    runWithNikolausWriteGate(async () => {
      saved = true;
    }),
    NikolausMaintenanceError
  );
  assert.equal(saved, true);
  assert.equal((await readNikolausWriteGate()).writers.length, 1);
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, false);
});

test('an ambiguous registration is cleaned up without running the handler', async (t) => {
  setupSharedState(t);
  const create = sharePoint.createSharePointListItem;
  t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (list: string, fields: Record<string, unknown>) => {
      await create(list, fields);
      throw new Error('simulated lost registration response');
    }
  );
  let entered = false;
  await assert.rejects(
    runWithNikolausWriteGate(async () => {
      entered = true;
    }),
    NikolausMaintenanceError
  );
  assert.equal(entered, false);
  assert.deepEqual((await readNikolausWriteGate()).writers, []);
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, true);
});

test('lost maintenance claim response keeps the durable owner and permits its explicit retry', async (t) => {
  setupSharedState(t);
  const create = sharePoint.createSharePointListItem;
  t.mock.method(
    sharePoint,
    'createSharePointListItem',
    async (list: string, fields: Record<string, unknown>) => {
      await create(list, fields);
      throw new Error('simulated lost claim response');
    }
  );
  await assert.rejects(beginNikolausMaintenance(OWNER), NikolausMaintenanceError);
  assert.equal((await readNikolausWriteGate()).maintenance?.owner, OWNER);
  assert.equal((await beginNikolausMaintenance(OWNER)).ready, true);
  await assert.rejects(
    runWithNikolausWriteGate(async () => assert.fail('blocked writer')),
    NikolausMaintenanceError
  );
});

for (const malformed of [
  { schema: 2, writers: [] },
  { schema: 1, writers: [{ id: 'paused', startedAt: 'invalid' }] },
  {
    schema: 1,
    writers: [
      { id: 'duplicate', startedAt: '2000-01-01' },
      { id: 'duplicate', startedAt: '2000-01-01' },
    ],
  },
  { schema: 1, writers: [], maintenance: { owner: '', startedAt: '2000-01-01' } },
]) {
  test('damaged registry refuses both writer admission and maintenance deletion', async (t) => {
    const state = setupSharedState(t);
    state.seed(NIKOLAUS_WRITE_GATE_KEY, malformed);
    await assert.rejects(
      runWithNikolausWriteGate(async () => assert.fail('damaged registry')),
      NikolausMaintenanceError
    );
    await assert.rejects(beginNikolausMaintenance(OWNER), NikolausMaintenanceError);
    assert.equal(state.writes.updates, 0);
  });
}

test('unconfigured shared state refuses mutations before running any handler', async (t) => {
  setupSharedState(t);
  t.mock.method(environment, 'getEnvironment', () => {
    throw new Error('missing state configuration');
  });
  await assert.rejects(
    runWithNikolausWriteGate(async () => assert.fail('missing state')),
    NikolausMaintenanceError
  );
  await assert.rejects(beginNikolausMaintenance(OWNER), NikolausMaintenanceError);
});

test('admission blocked by a claimed gate carries its exact durable maintenance owner', async (t) => {
  setupSharedState(t);
  await beginNikolausMaintenance(OWNER);
  await assert.rejects(
    runWithNikolausWriteGate(async () => assert.fail('maintenance writer must not run')),
    (error: unknown) => {
      assert.ok(error instanceof NikolausMaintenanceError);
      assert.equal(error.maintenanceOwner, OWNER);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'MAINTENANCE');
      return true;
    }
  );
});

test('store outages cannot impersonate a verified maintenance claim', async (t) => {
  setupSharedState(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('simulated store outage');
  });
  await assert.rejects(
    runWithNikolausWriteGate(async () => assert.fail('outage writer must not run')),
    (error: unknown) => {
      assert.ok(error instanceof NikolausMaintenanceError);
      assert.equal(error.maintenanceOwner, undefined);
      return true;
    }
  );
});

test('malformed state does not expose an unverified maintenance owner', async (t) => {
  const state = setupSharedState(t);
  state.seed(NIKOLAUS_WRITE_GATE_KEY, {
    schema: 1,
    writers: 'corrupt',
    maintenance: { owner: OWNER, startedAt: '2000-01-01' },
  });
  await assert.rejects(
    runWithNikolausWriteGate(async () => assert.fail('corrupt writer must not run')),
    (error: unknown) => {
      assert.ok(error instanceof NikolausMaintenanceError);
      assert.equal(error.maintenanceOwner, undefined);
      return true;
    }
  );
});
