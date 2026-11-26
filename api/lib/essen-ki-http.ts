import type { HttpResponseInit } from '@azure/functions';
import { KiNichtVerfuegbar } from './essen-ki';
import { PlanungError } from './essen-zugang';
import { NO_STORE_HEADERS } from './response-utils';

/**
 * The answers of the AI's errors for endpoints outside `planungHandler` (the Steuerung): a busy
 * deployment is „KI gerade nicht verfügbar“ with `Retry-After`, a missing one or an unusable
 * answer keeps its status and text. Null for any other error.
 */
export function kiFehlerAntwort(error: unknown): HttpResponseInit | null {
  if (error instanceof KiNichtVerfuegbar)
    return {
      status: error.status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { 'Retry-After': String(error.retryAfterSeconds) }),
      },
      jsonBody: {
        error: 'KI_NICHT_VERFUEGBAR',
        code: 'KI_NICHT_VERFUEGBAR',
        message: error.message,
        ...(error.retryAfterSeconds === undefined ? {} : { retryAfter: error.retryAfterSeconds }),
      },
    };
  if (error instanceof PlanungError)
    return {
      status: error.status,
      headers: NO_STORE_HEADERS,
      jsonBody: { error: error.code, code: error.code, message: error.message },
    };
  return null;
}
