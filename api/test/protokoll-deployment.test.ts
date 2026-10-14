import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProtokollDeployment } from '../lib/protokoll-deployment';
import { ProtokollCutoverStatus } from '../endpoints/protokoll-cutover-status';

test('old or incompatible deployments cannot activate SQL; the probe exposes no private state', async (t) => {
  for (const [status, body] of [
    [404, {}],
    [200, {}],
    [200, { protocolBackend: 'legacy' }],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
    await assert.rejects(assertProtokollDeployment(), /SQL_GATE_DEPLOYMENT_REQUIRED/);
    mock.mock.restore();
  }
  const capability = await ProtokollCutoverStatus();
  assert.deepEqual(capability.jsonBody, { protocolBackend: 'sql-gated-v1' });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).origin, 'https://www.stamm-phoenix.de');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    return Response.json(capability.jsonBody);
  });
  await assertProtokollDeployment();
});
