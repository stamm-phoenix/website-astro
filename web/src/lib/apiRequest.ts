import { ApiError, SESSION_EXPIRED_MESSAGE, toApiError } from './apiError';
import {
  READ_TIMEOUT_MESSAGE,
  TIMEOUT_MS,
  WRITE_TIMEOUT_MESSAGE,
  deadline,
  type Deadline,
} from './apiTimeout';

export const API_BASE = '/api';

/**
 * Sends an uncached request and returns the successful response. Errors are thrown as `ApiError`.
 * Internal requests do not follow redirects: the platform redirects them to the Microsoft login
 * once the login has expired, and following that would fail like a lost connection.
 *
 * A request without an answer within `timeoutMs` (until the headers arrive) fails with code
 * `TIMEOUT`; `init.signal` aborts it earlier and rethrows the `AbortError`. A read (GET) is sent
 * once more after a timeout or a lost connection; a write never is, because it may have been
 * saved, and its message tells the user to check first. A `?refresh=true` read gets the longer
 * `TIMEOUT_MS.reload` and is never repeated; a `/ki/` evaluation gets `TIMEOUT_MS.evaluation` and
 * the message of a read, because it saves nothing. Other POSTs that only look something up pass
 * `saves: false` for the same message. The message of a write tells the user to check first.
 *
 * `consume` reads the answer (`json()`, `blob()`). It runs inside the same attempt: the time
 * limit ends with the headers, but the caller's abort and the retry of a read also cover a
 * connection that breaks while the body is still arriving.
 */
export async function request<T>(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
  saves: boolean = (init.method ?? 'GET') !== 'GET'
): Promise<T> {
  const read = (init.method ?? 'GET') === 'GET';
  // A reload from CampFlow runs several slow requests on the server; repeating it starts them again
  const reload = /[?&]refresh=true\b/.test(endpoint);
  // An evaluation by the language model (`/ki/`) takes long on the server and saves nothing
  const evaluation = endpoint.includes('/ki/');
  const limitMs = reload ? TIMEOUT_MS.reload : evaluation ? TIMEOUT_MS.evaluation : timeoutMs;
  const mayHaveSaved = saves && !evaluation;
  for (let attempt = 0; ; attempt++) {
    const limit = deadline(limitMs, init.signal ?? undefined);
    try {
      const response = await send(endpoint, { ...init, signal: limit.signal }, limit);
      return await consume(response);
    } catch (error: unknown) {
      const lost = limit.timedOut() || (error instanceof TypeError && !init.signal?.aborted);
      if (read && !reload && attempt === 0 && lost) continue;
      if (limit.timedOut()) {
        recordFailure(endpoint, 0, 'TIMEOUT', null);
        throw new ApiError(0, mayHaveSaved ? WRITE_TIMEOUT_MESSAGE : READ_TIMEOUT_MESSAGE, {
          code: 'TIMEOUT',
        });
      }
      throw error;
    } finally {
      limit.clear();
    }
  }
}

/** One attempt; the time limit ends with the headers of any answer, also an error status. */
async function send(endpoint: string, init: RequestInit, limit: Deadline): Promise<Response> {
  const internal = endpoint.startsWith('/intern/');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...init,
      cache: 'no-store',
      ...(internal ? { redirect: 'manual' } : {}),
    });
  } catch (error: unknown) {
    if (!init.signal?.aborted) recordFailure(endpoint, 0, 'NETWORK', null);
    throw error;
  }
  limit.headersReceived();
  if (internal && response.type === 'opaqueredirect') {
    recordFailure(endpoint, 401, '', response);
    throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) {
    const error = await toApiError(response, internal);
    recordFailure(endpoint, response.status, error.code ?? '', response);
    throw error;
  }
  return response;
}

/**
 * The last failed request: what „Problem melden“ adds to a report (`problemMelden.ts`). Only
 * status, code, route without query and a correlation number of the response, never a message
 * or content.
 */
export interface ApiFailure {
  status: number;
  code: string;
  route: string;
  correlationId: string;
  at: number;
}

let lastFailure: ApiFailure | null = null;

function recordFailure(
  endpoint: string,
  status: number,
  code: string,
  response: Response | null
): void {
  // A failing report must not replace the problem it is about
  if (endpoint.startsWith('/problemmeldung')) return;
  lastFailure = {
    status,
    code,
    route: `${API_BASE}${endpoint.split('?')[0]}`,
    // The ID of the request at Cloudflare or Azure, if one answered
    correlationId:
      response?.headers.get('x-ms-request-id') ??
      response?.headers.get('x-request-id') ??
      response?.headers.get('cf-ray') ??
      '',
    at: Date.now(),
  };
}

/** The failed request of the last ten minutes, if any; older ones no longer explain the page. */
export function getLastApiFailure(maxAgeMs = 600_000): ApiFailure | null {
  return lastFailure && Date.now() - lastFailure.at <= maxAgeMs ? lastFailure : null;
}
