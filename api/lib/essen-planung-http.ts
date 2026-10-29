import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { RecordNotFoundError, VersionConflictError } from './db';
import type { Zugang } from './essen-planung';
import { PlanungError, ladeAnsicht, ladeZugang } from './essen-planung';
import { readEtag as parseEtag } from './essen-planung-request';
import { NO_STORE_HEADERS } from './nikolaus-api';
import { errorResponse, withErrorHandling } from './response-utils';
import { ValidationError } from './validation/errors';

/**
 * What the endpoints of a Planung share (`api/endpoints/essensplanung*.ts`): the answers, the
 * access by the link's token, and the mapping of errors, where conflicts bring the current view.
 */

export const TOKEN_HEADER = 'x-essensplanung-token';

export function ok(jsonBody: unknown, status = 200): HttpResponseInit {
  return { status, headers: NO_STORE_HEADERS, jsonBody };
}

export const METHOD_NOT_ALLOWED: HttpResponseInit = {
  ...errorResponse(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.'),
  headers: NO_STORE_HEADERS,
};

/** Maps the errors of a request on a Planung; conflicts and missing entries bring the view. */
export function planungHandler(
  handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>
) {
  return withErrorHandling(async (request: HttpRequest, context: InvocationContext) => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      const zugang = (request as { essenZugang?: Zugang }).essenZugang;
      const ansicht = async () => (zugang ? await ladeAnsicht(zugang).catch(() => null) : null);
      if (error instanceof PlanungError) {
        return {
          status: error.status,
          headers: NO_STORE_HEADERS,
          jsonBody: { error: error.code, code: error.code, message: error.message },
        };
      }
      if (error instanceof ValidationError) {
        return {
          status: 400,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'INVALID',
            code: 'INVALID',
            message: error.message,
            fields: error.fields,
          },
        };
      }
      if (error instanceof VersionConflictError) {
        return {
          status: 409,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'CONFLICT',
            code: 'CONFLICT',
            message:
              'Jemand anderes hat das gerade geändert. Die Seite zeigt jetzt den aktuellen Stand; deine Eingabe ist noch da.',
            ansicht: await ansicht(),
          },
        };
      }
      if (error instanceof RecordNotFoundError) {
        return {
          status: 404,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'NOT_FOUND',
            code: 'NOT_FOUND',
            message: 'Das gibt es inzwischen nicht mehr; jemand anderes hat es gelöscht.',
            ansicht: await ansicht(),
          },
        };
      }
      throw error;
    }
  });
}

/** Reads the token of the request's link and remembers the access for the error answers. */
export async function zugangVon(request: HttpRequest): Promise<Zugang> {
  const zugang = await ladeZugang(request.headers.get(TOKEN_HEADER));
  (request as { essenZugang?: Zugang }).essenZugang = zugang;
  return zugang;
}

export function readId(request: HttpRequest): number {
  const id = request.params.id ?? '';
  if (!/^\d{1,9}$/.test(id)) throw new RecordNotFoundError();
  return Number(id);
}

export function readEtag(body: Record<string, unknown> | null, request: HttpRequest): string {
  return parseEtag(body, request.headers.get('if-match'));
}
