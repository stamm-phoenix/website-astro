import { getCredential } from './token';

interface DeploymentDependencies {
  fetch: typeof fetch;
  token: () => Promise<string>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hostname(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9.-]+\.azurestaticapps\.net$/i.test(value)) {
    throw new Error('Invalid Static Web App hostname');
  }
  return value.toLowerCase();
}

/** Checks every deployed environment, including old previews, without loading a real booking. */
export async function verifyNikolausMaintenanceDeployment(
  resourceId: string,
  maintenanceOwner: string,
  dependencies: DeploymentDependencies = {
    fetch,
    token: async () => {
      const token = await getCredential().getToken('https://management.azure.com/.default');
      if (!token) throw new Error('Azure inventory authentication failed');
      return token.token;
    },
  }
): Promise<void> {
  if (!/^[a-zA-Z0-9:_.-]{1,180}$/.test(maintenanceOwner))
    throw new Error('Invalid maintenance owner');
  if (
    !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-z0-9_.-]+\/providers\/Microsoft\.Web\/staticSites\/[a-z0-9-]+$/i.test(
      resourceId
    )
  ) {
    throw new Error('Invalid Static Web App resource ID');
  }
  const token = await dependencies.token();
  async function management(url: string): Promise<unknown> {
    const response = await dependencies.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Azure deployment inventory unavailable');
    return response.json() as Promise<unknown>;
  }
  const base = `https://management.azure.com${resourceId}`;
  const site = await management(`${base}?api-version=2024-11-01`);
  if (!object(site) || !object(site.properties)) throw new Error('Invalid Azure site inventory');
  if (Array.isArray(site.properties.linkedBackends) && site.properties.linkedBackends.length) {
    throw new Error('Linked backends require a separate retention review');
  }
  const hosts = new Set([hostname(site.properties.defaultHostname)]);
  let next: string | undefined = `${base}/builds?api-version=2024-11-01`;
  const pages = new Set<string>();
  while (next) {
    const url = new URL(next);
    if (
      url.origin !== 'https://management.azure.com' ||
      url.pathname !== `${resourceId}/builds` ||
      pages.has(url.href)
    ) {
      throw new Error('Invalid Azure inventory continuation');
    }
    pages.add(url.href);
    const page = await management(url.href);
    if (!object(page) || !Array.isArray(page.value))
      throw new Error('Invalid Azure build inventory');
    for (const build of page.value) {
      if (!object(build) || !object(build.properties) || build.properties.status !== 'Ready') {
        throw new Error('Static Web App environment is not ready');
      }
      hosts.add(hostname(build.properties.hostname));
    }
    if (page.nextLink !== undefined && typeof page.nextLink !== 'string') {
      throw new Error('Invalid Azure inventory continuation');
    }
    next = typeof page.nextLink === 'string' && page.nextLink ? page.nextLink : undefined;
  }
  for (const host of hosts) {
    const response = await dependencies.fetch(`https://${host}/api/nikolaus/manage/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await response.json();
    if (
      response.status !== 503 ||
      response.headers.get('x-nikolaus-write-gate') !== 'v1' ||
      response.headers.get('x-nikolaus-maintenance-owner') !== maintenanceOwner ||
      !object(body) ||
      body.code !== 'MAINTENANCE'
    ) {
      throw new Error('A deployed environment does not honor the shared maintenance gate');
    }
  }
}
