import { CONFIG } from './config';
import { EnvironmentVariable, findEnvironment } from './environment';
import { getCredential } from './token';

/**
 * Requests to Azure Maps (geocoding of the Nikolaus addresses, driving times and routes of the
 * Dispo). With `AZURE_MAPS_API_KEY` the key is used, otherwise the app registration (Entra ID)
 * with the role „Azure Maps Data Reader“ on the account `CONFIG.azureMaps.clientId`. See
 * docs/nikolaus-betrieb.md for the setup.
 */

export class AzureMapsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AzureMapsError';
  }
}

export interface AzureMapsRequest {
  method: 'GET' | 'POST';
  /** Path below the endpoint, e.g. `/geocode`. */
  path: string;
  /** Versions differ per API, see `CONFIG.azureMaps`. */
  apiVersion: string;
  /** Query parameters besides `api-version`. */
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

/** Whether a key or the account for the Entra login is set; otherwise nothing is requested. */
export function isAzureMapsConfigured(): boolean {
  return !!findEnvironment(EnvironmentVariable.AZURE_MAPS_API_KEY) || !!CONFIG.azureMaps.clientId;
}

async function authHeaders(): Promise<Record<string, string>> {
  const apiKey = findEnvironment(EnvironmentVariable.AZURE_MAPS_API_KEY)?.trim();
  if (apiKey) return { 'subscription-key': apiKey };
  if (!CONFIG.azureMaps.clientId) throw new AzureMapsError('Azure Maps is not configured');
  const token = await getCredential().getToken('https://atlas.microsoft.com/.default');
  if (!token) throw new AzureMapsError('Failed to acquire Azure Maps access token');
  return { Authorization: `Bearer ${token.token}`, 'x-ms-client-id': CONFIG.azureMaps.clientId };
}

/**
 * Sends a request and returns the parsed JSON answer, unchecked. The deadline also covers the
 * login. Errors carry only the HTTP status, never addresses or coordinates, so they can be
 * logged.
 */
export async function requestAzureMaps(request: AzureMapsRequest): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AzureMapsError('Azure Maps request timed out'));
    }, request.timeoutMs);
  });
  try {
    return await Promise.race([perform(request, controller.signal), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

async function perform(request: AzureMapsRequest, signal: AbortSignal): Promise<unknown> {
  const url = new URL(request.path, CONFIG.azureMaps.endpoint);
  url.searchParams.set('api-version', request.apiVersion);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  let response: Response;
  try {
    const headers = await authHeaders();
    if (signal.aborted) throw new AzureMapsError('Azure Maps request timed out');
    response = await fetch(url, {
      method: request.method,
      headers: {
        'Accept-Language': 'de-DE',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/geo+json' }),
        ...headers,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal,
    });
  } catch (error: unknown) {
    if (error instanceof AzureMapsError) throw error;
    throw new AzureMapsError(
      signal.aborted ? 'Azure Maps request timed out' : 'Azure Maps unreachable'
    );
  }
  // 429: the rate limit of the account
  if (!response.ok) throw new AzureMapsError(`Azure Maps request failed: ${response.status}`);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AzureMapsError('Unreadable answer of Azure Maps');
  }
}
