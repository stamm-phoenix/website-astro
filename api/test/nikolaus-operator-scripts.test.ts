import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import * as gate from '../lib/nikolaus-write-gate';
import * as geocoding from '../lib/geocoding-recovery';
import * as deployment from '../lib/nikolaus-retention-deployment';
import * as backendFactory from '../lib/nikolaus-retention-backend';
import {
  planNikolausRetention,
  retentionDigest,
  type RetentionBackend,
  type RetentionSources,
} from '../lib/nikolaus-retention';
import { runNikolausMaintenance } from '../scripts/nikolaus-maintenance';
import { runNikolausRetention } from '../scripts/nikolaus-retention';
import { setupSharedState } from './fixtures/shared-state';

const OWNER = 'operator-recovery-test';
const TARGET = retentionDigest('operator-test-lists');

for (const existing of [false, true]) {
  test(`failed recovery exposes its owner and permits the same-owner retry (existing=${existing})`, async (t) => {
    setupSharedState(t);
    t.mock.method(console, 'log', () => undefined);
    t.mock.method(geocoding, 'readGeocodingReservationStatus', async () => ({
      owner: null,
      startedAt: null,
    }));
    if (existing) await gate.beginNikolausMaintenance(OWNER);
    const read = gate.readNikolausWriteGate;
    let reads = 0;
    const failingRead = t.mock.method(gate, 'readNikolausWriteGate', async () => {
      if (++reads === 2) throw Object.assign(new Error('Unavailable state'), { statusCode: 503 });
      return read();
    });
    const args = ['--recover', '--owner', OWNER, '--processes-stopped-confirmed'];
    await assert.rejects(runNikolausMaintenance(args), (error: unknown) => {
      assert.ok(error instanceof Error && 'owner' in error && 'code' in error);
      assert.equal(error.owner, OWNER);
      assert.equal(error.code, '503');
      return true;
    });
    failingRead.mock.restore();
    assert.equal((await gate.readNikolausWriteGate()).maintenance?.owner, OWNER);
    await runNikolausMaintenance(args);
    assert.equal((await gate.readNikolausWriteGate()).maintenance, undefined);
  });
}

function retentionFixture(t: TestContext) {
  setupSharedState(t);
  t.mock.method(console, 'log', () => undefined);
  const previousResource = process.env.NIKOLAUS_RETENTION_AZURE_RESOURCE_ID;
  process.env.NIKOLAUS_RETENTION_AZURE_RESOURCE_ID = 'test-static-web-app';
  t.after(() => {
    if (previousResource === undefined) delete process.env.NIKOLAUS_RETENTION_AZURE_RESOURCE_ID;
    else process.env.NIKOLAUS_RETENTION_AZURE_RESOURCE_ID = previousResource;
  });
  const directory = mkdtempSync(join(tmpdir(), 'nikolaus-operator-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const planPath = join(directory, 'plan.json');
  const reportPath = join(directory, 'report.json');
  const sources: RetentionSources = {
    booking: [{ id: 'old-booking', eTag: '"1"', fields: { SlotKey: '2025-12-06T17:00' } }],
    dispo: [],
    helper: [],
    einteilung: [],
    states: [],
  };
  const calls: string[] = [];
  const backend: RetentionBackend = {
    load: async () => {
      calls.push('load');
      return structuredClone(sources);
    },
    delete: async (operation) => {
      assert.equal(operation.id, 'old-booking');
      assert.ok(calls.includes('verified'), 'Deployment verification must precede deletion');
      calls.push('delete');
      sources.booking = [];
    },
    updateState: async () => assert.fail('No state updates in this plan'),
  };
  t.mock.method(backendFactory, 'createNikolausRetentionBackend', () => ({
    targetDigest: TARGET,
    backend,
  }));
  const plan = planNikolausRetention(
    sources,
    {
      season: 2025,
      before: '2026-01-01',
      responsibleRole: 'Nikolauskoordination',
    },
    TARGET
  );
  writeFileSync(planPath, JSON.stringify(plan));
  const args = ['--apply', '--maintenance-confirmed', '--plan', planPath, '--report', reportPath];
  return { sources, calls, planPath, reportPath, args };
}

test('manual retention verifies the current owner in every deployment before deleting', async (t) => {
  const fixture = retentionFixture(t);
  let verifiedOwner: string | undefined;
  t.mock.method(
    deployment,
    'verifyNikolausMaintenanceDeployment',
    async (resourceId: string, owner: string) => {
      assert.equal(resourceId, 'test-static-web-app');
      assert.equal((await gate.readNikolausWriteGate()).maintenance?.owner, owner);
      verifiedOwner = owner;
      fixture.calls.push('verified');
    }
  );
  await runNikolausRetention(fixture.args);
  assert.ok(verifiedOwner);
  assert.ok(fixture.calls.indexOf('verified') < fixture.calls.indexOf('delete'));
  assert.equal(
    (JSON.parse(readFileSync(fixture.reportPath, 'utf8')) as { complete: boolean }).complete,
    true
  );
  assert.equal((await gate.readNikolausWriteGate()).maintenance, undefined);
});

test('an incompatible deployment stops manual retention before loading or deleting records', async (t) => {
  const fixture = retentionFixture(t);
  t.mock.method(deployment, 'verifyNikolausMaintenanceDeployment', async () => {
    throw new Error('An old preview remains writable');
  });
  await assert.rejects(runNikolausRetention(fixture.args), /old preview/);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.sources.booking.length, 1);
  const report = JSON.parse(readFileSync(fixture.reportPath, 'utf8')) as {
    complete: boolean;
    status: string;
  };
  assert.equal(report.complete, false);
  assert.equal(report.status, 'stopped');
  assert.equal((await gate.readNikolausWriteGate()).maintenance, undefined);
});

test('retention preview uses the shared backend without claiming maintenance or verifying deployments', async (t) => {
  const fixture = retentionFixture(t);
  t.mock.method(gate, 'beginNikolausMaintenance', async () =>
    assert.fail('Preview cannot claim maintenance')
  );
  t.mock.method(deployment, 'verifyNikolausMaintenanceDeployment', async () =>
    assert.fail('Preview cannot require Azure access')
  );
  await runNikolausRetention([
    '--season',
    '2025',
    '--before',
    '2026-01-01',
    '--responsible',
    'Nikolauskoordination',
    '--plan',
    fixture.planPath,
  ]);
  assert.deepEqual(fixture.calls, ['load']);
  const plan = JSON.parse(readFileSync(fixture.planPath, 'utf8')) as {
    targetDigest: string;
    operations: unknown[];
  };
  assert.equal(plan.targetDigest, TARGET);
  assert.equal(plan.operations.length, 1);
  assert.equal(fixture.sources.booking.length, 1);
});
