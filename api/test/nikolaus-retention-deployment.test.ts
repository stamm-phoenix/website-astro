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
      if (new URL(url).origin === 'https://management.azure.com') {
        assert.equal(options?.redirect, 'error');
        assert.equal(
          new Headers(options?.headers).get('authorization'),
          'Bearer simulated-inventory-token'
        );
        if (url.includes('/builds'))
          return Response.json({
            value: [{ properties: { hostname: 'preview.azurestaticapps.net', status: 'Ready' } }],
            nextLink: null,
            ...(failure === 'unsafe-page'
              ? { nextLink: 'https://foreign.example.invalid/builds' }
              : {}),
          });
        return Response.json({
          properties: { defaultHostname: 'production.azurestaticapps.net', linkedBackends: [] },
        });
      }
      assert.equal(new Headers(options?.headers).get('authorization'), null);
      assert.equal(options?.redirect, url.includes('production.') ? 'manual' : 'error');
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

function canonicalSimulation(
  location = 'https://www.example.org/api/nikolaus/manage/update',
  domainStatus = 'Ready',
  redirectPreview = false
): ReturnType<typeof simulation> {
  const original = simulation();
  const fetchOriginal = original.fetch;
  original.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes('/customDomains/')) {
      assert.equal(new URL(url).origin, 'https://management.azure.com');
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        'Bearer simulated-inventory-token'
      );
      if (!url.includes('/customDomains/www.example.org?'))
        return new Response(null, { status: 404 });
      return Response.json({ properties: { domainName: 'www.example.org', status: domainStatus } });
    }
    if (
      url.startsWith('https://production.') ||
      (redirectPreview && url.startsWith('https://preview.'))
    ) {
      original.probes.push(url);
      return new Response(null, { status: 301, headers: { location } });
    }
    if (url.startsWith('https://www.example.org/')) {
      assert.equal(options?.redirect, 'error');
      assert.equal(options?.method, 'POST');
      assert.equal(options?.body, JSON.stringify({ token: '' }));
      assert.equal(new Headers(options?.headers).get('authorization'), null);
      original.probes.push(url);
      return Response.json(
        { code: 'MAINTENANCE' },
        {
          status: 503,
          headers: { 'x-nikolaus-write-gate': 'v1', 'x-nikolaus-maintenance-owner': OWNER },
        }
      );
    }
    return fetchOriginal(input, options);
  };
  return original;
}

test('production canonical redirect is checked against its ready Azure domain and preserves POST', async () => {
  const dependencies = canonicalSimulation();
  await verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, dependencies);
  assert.deepEqual(dependencies.probes, [
    'https://production.azurestaticapps.net/api/nikolaus/manage/update',
    'https://www.example.org/api/nikolaus/manage/update',
    'https://preview.azurestaticapps.net/api/nikolaus/manage/update',
  ]);
});

for (const location of [
  'https://foreign.example.org/api/nikolaus/manage/update',
  'http://www.example.org/api/nikolaus/manage/update',
  'https://www.example.org:444/api/nikolaus/manage/update',
  'https://user:password@www.example.org/api/nikolaus/manage/update',
  'https://www.example.org/different-path',
  'https://www.example.org/api/nikolaus/manage/update?token=unexpected',
  'https://www.example.org/api/nikolaus/manage/update#fragment',
]) {
  test(`canonical redirect rejects untrusted target ${location}`, async () => {
    const dependencies = canonicalSimulation(location);
    await assert.rejects(verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, dependencies));
    assert.deepEqual(dependencies.probes, [
      'https://production.azurestaticapps.net/api/nikolaus/manage/update',
    ]);
  });
}

test('canonical redirect rejects an unready Azure domain', async () => {
  await assert.rejects(
    verifyNikolausMaintenanceDeployment(
      RESOURCE,
      OWNER,
      canonicalSimulation(undefined, 'Validating')
    )
  );
});

test('previews cannot redirect their maintenance probe to the production domain', async () => {
  await assert.rejects(
    verifyNikolausMaintenanceDeployment(
      RESOURCE,
      OWNER,
      canonicalSimulation(undefined, undefined, true)
    )
  );
});

test('canonical production must still return the claimed maintenance owner', async () => {
  const dependencies = canonicalSimulation();
  const originalFetch = dependencies.fetch;
  dependencies.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).startsWith('https://www.example.org/')) {
      response.headers.set('x-nikolaus-maintenance-owner', 'another-owner');
    }
    return response;
  };
  await assert.rejects(verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, dependencies));
});

test('canonical production cannot forward the maintenance probe a second time', async () => {
  const dependencies = canonicalSimulation();
  const originalFetch = dependencies.fetch;
  dependencies.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).startsWith('https://www.example.org/')) {
      return new Response(null, {
        status: 301,
        headers: { location: 'https://foreign.example.org/api/nikolaus/manage/update' },
      });
    }
    return response;
  };
  await assert.rejects(verifyNikolausMaintenanceDeployment(RESOURCE, OWNER, dependencies));
  assert.equal(
    dependencies.probes.some((url) => url.includes('foreign.example.org')),
    false
  );
});

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
