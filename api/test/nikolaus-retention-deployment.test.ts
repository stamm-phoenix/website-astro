import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyNikolausMaintenanceDeployment } from '../lib/nikolaus-retention-deployment';

const RESOURCE =
  '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test/providers/Microsoft.Web/staticSites/test';
const OWNER = 'simulated-maintenance-owner';

function simulation(failure?: 'old' | 'outage' | 'foreign-owner' | 'unsafe-page'): {
  fetch: typeof fetch;
  token: () => Promise<string>;
  probes: string[];
} {
  const probes: string[] = [];
  return {
    token: async () => 'simulated-inventory-token',
    probes,
    fetch: async (input, options) => {
      const url = String(input);
      assert.equal(options?.redirect, 'error');
      if (new URL(url).origin === 'https://management.azure.com') {
        assert.equal(
          new Headers(options?.headers).get('authorization'),
          'Bearer simulated-inventory-token'
        );
        if (url.includes('/builds'))
          return Response.json({
            value: [{ properties: { hostname: 'preview.azurestaticapps.net', status: 'Ready' } }],
            ...(failure === 'unsafe-page'
              ? { nextLink: 'https://foreign.example.invalid/builds' }
              : {}),
          });
        return Response.json({
          properties: { defaultHostname: 'production.azurestaticapps.net', linkedBackends: [] },
        });
      }
      assert.equal(new Headers(options?.headers).get('authorization'), null);
      assert.equal(options?.method, 'POST');
      assert.equal(options?.body, JSON.stringify({ token: '' }));
      probes.push(url);
      if (failure === 'old' && url.includes('preview.'))
        return Response.json({ code: 'INVALID_TOKEN' }, { status: 404 });
      return Response.json(
        { code: 'MAINTENANCE' },
        {
          status: 503,
          headers: {
            'x-nikolaus-write-gate': 'v1',
            ...(failure === 'outage'
              ? {}
              : {
                  'x-nikolaus-maintenance-owner':
                    failure === 'foreign-owner' ? 'another-owner' : OWNER,
                }),
          },
        }
      );
    },
  };
}

test('deployment verification enumerates and probes production and every preview without using real tokens', async () => {
  const dependencies = simulation();
  await verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, dependencies);
  assert.deepEqual(dependencies.probes, [
    'https://production.azurestaticapps.net/api/nikolaus/manage/update',
    'https://preview.azurestaticapps.net/api/nikolaus/manage/update',
  ]);
});

for (const failure of ['old', 'outage', 'foreign-owner', 'unsafe-page'] as const) {
  test(`deployment ${failure} fails closed before cleanup`, async () => {
    await assert.rejects(verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, simulation(failure)));
  });
}
