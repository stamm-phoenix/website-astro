import { createHmac } from 'node:crypto';
import { PREVIEW_DATABASE } from './deployment';
import { EnvironmentVariable, findEnvironment } from './environment';
import type { ClientPrincipal } from './staff-principal-model';

/**
 * Usage events of the Leitendenbereich in Application Insights (`customEvents`), evaluated in the
 * workbook of `infrastructure/usage-workbook.bicep` (`docs/nutzungsstatistik.md`). Events carry
 * a pseudonym instead of a name or an e-mail address, and nothing of what was entered.
 *
 * The events go straight to the ingestion endpoint, so the Functions host stays unconnected and
 * its log lines (which name the acting user) never reach Application Insights. Without
 * `USAGE_INSIGHTS_CONNECTION_STRING` (previews, local development) nothing is sent.
 */

/** Opening a module (`StaffNav` → `/api/intern/haeufig`). */
export const MODULE_OPENED = 'StaffModuleOpened';
/** A successful write in an area of the Leitendenbereich (`staffHandler`). */
export const STAFF_ACTION = 'StaffAction';

const DEFAULT_INGESTION = 'https://dc.services.visualstudio.com/';
const TIMEOUT_MS = 2000;

interface InsightsTarget {
  instrumentationKey: string;
  trackUrl: string;
}

/** The instrumentation key and track URL of a connection string, `null` if it has no key. */
export function parseConnectionString(value: string): InsightsTarget | null {
  const parts = new Map<string, string>();
  for (const part of value.split(';')) {
    const index = part.indexOf('=');
    if (index > 0)
      parts.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  const instrumentationKey = parts.get('instrumentationkey');
  if (!instrumentationKey) return null;
  const endpoint = parts.get('ingestionendpoint') || DEFAULT_INGESTION;
  return {
    instrumentationKey,
    trackUrl: new URL('v2.1/track', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).href,
  };
}

/**
 * A stable pseudonym of the person: the same for every event of one login, without the secret
 * not traceable to the account. `undefined` without `USAGE_PSEUDONYM_SECRET`, then events count
 * without telling people apart.
 */
export function pseudonymOf(principal: ClientPrincipal): string | undefined {
  const secret = findEnvironment(EnvironmentVariable.USAGE_PSEUDONYM_SECRET);
  if (!secret) return undefined;
  return createHmac('sha256', secret)
    .update(`${principal.identityProvider}:${principal.userId}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Sends one event. Never throws and gives up after two seconds: a lost event must not fail or
 * slow down what the person did.
 */
export async function trackStaffEvent(
  name: string,
  principal: ClientPrincipal,
  properties: Record<string, string>,
  now = new Date()
): Promise<void> {
  const connection = findEnvironment(EnvironmentVariable.USAGE_INSIGHTS_CONNECTION_STRING);
  const target = connection ? parseConnectionString(connection) : null;
  if (!target) return;
  const user = pseudonymOf(principal);
  const envelope = {
    name: 'Microsoft.ApplicationInsights.Event',
    time: now.toISOString(),
    iKey: target.instrumentationKey,
    tags: {
      'ai.cloud.role': 'website-api',
      ...(user ? { 'ai.user.id': user } : {}),
    },
    data: {
      baseType: 'EventData',
      baseData: {
        ver: 2,
        name,
        properties: { ...properties, environment: PREVIEW_DATABASE ? 'preview' : 'production' },
      },
    },
  };
  try {
    const response = await fetch(target.trackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([envelope]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.warn(`Usage event not accepted: HTTP ${response.status}`);
  } catch (error: unknown) {
    console.warn(`Usage event not sent: ${error instanceof Error ? error.name : 'unknown'}`);
  }
}
