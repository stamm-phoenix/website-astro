import { PRODUCTION_SITE_URL } from './public-site';

/** Read-only capability proof at the fixed production origin; never sends credentials. */
export async function assertProtokollDeployment(): Promise<void> {
  const response = await fetch(
    `${PRODUCTION_SITE_URL}/api/protokoll-cutover-status?probe=${Date.now()}`,
    {
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
      credentials: 'omit',
    }
  );
  const value: unknown = await response.json().catch(() => undefined);
  if (
    !response.ok ||
    !value ||
    typeof value !== 'object' ||
    !('protocolBackend' in value) ||
    value.protocolBackend !== 'sql-gated-v1'
  )
    throw new Error('SQL_GATE_DEPLOYMENT_REQUIRED');
}

/** Observe the gated API while old Azure HTTP requests drain (maximum 230 seconds). */
export async function waitForProtokollDeployment(): Promise<void> {
  const retiredAt = Date.now() + 5 * 60_000;
  while (Date.now() < retiredAt) {
    await assertProtokollDeployment();
    console.log(JSON.stringify({ scope: 'protocol-migration', waitingForLegacyRequests: true }));
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, retiredAt - Date.now())));
  }
  await assertProtokollDeployment();
}
