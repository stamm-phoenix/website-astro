import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from './staff-auth';
import { isStaffError, requireStaff } from './staff-auth';
import { NO_STORE_HEADERS, readJsonBody } from './nikolaus-api';
import { errorResponse } from './response-utils';
import { getGraphStatus } from './sharepoint-data-access';
import { SharePointRestError } from './sharepoint-rest';
import { ValidationError } from './pflege-validation';

export { NO_STORE_HEADERS, readJsonBody };

export type PflegeHandler = (
  request: HttpRequest,
  context: InvocationContext,
  principal: ClientPrincipal
) => Promise<HttpResponseInit>;

export function ok(jsonBody: unknown, status = 200): HttpResponseInit {
  return { status, headers: NO_STORE_HEADERS, jsonBody };
}

export const NO_CONTENT: HttpResponseInit = { status: 204, headers: NO_STORE_HEADERS };

export const NOT_FOUND = errorResponse(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');

export const METHOD_NOT_ALLOWED = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.');

export const CONFLICT = errorResponse(
  409,
  'CONFLICT',
  'Der Eintrag wurde inzwischen von jemand anderem geändert. Bitte neu laden und erneut bearbeiten.'
);

/** Maps known SharePoint and validation errors to API responses; others are rethrown. */
function toErrorResponse(error: unknown): HttpResponseInit {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      jsonBody: { error: 'INVALID', code: 'INVALID', message: error.message, fields: error.fields },
    };
  }
  const status =
    error instanceof SharePointRestError ? error.status : (getGraphStatus(error) ?? undefined);
  if (status === 404) return NOT_FOUND;
  if (status === 409 || status === 412) return CONFLICT;
  throw error;
}

/**
 * Wraps a handler of the edit modules: requires a logged-in staff member, maps SharePoint and
 * validation errors and logs every change with the acting user, because SharePoint itself
 * only records the app as editor.
 */
export function pflegeHandler(area: string, handler: PflegeHandler) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const principal = requireStaff(request);
    if (isStaffError(principal)) return principal;

    try {
      const response = await handler(request, context, principal);
      if (request.method !== 'GET' && (response.status ?? 200) < 400) {
        context.log(
          `[pflege] ${principal.userDetails} ${request.method} ${area} ${request.params.id ?? ''}`.trim()
        );
      }
      return response;
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  };
}

/** The etag a bodyless or binary request (delete, photo upload) sends in `If-Match`. */
export function readIfMatch(request: HttpRequest): string | undefined {
  return request.headers.get('if-match') || undefined;
}

/** The `etag` from a request body, if present. */
export function readEtag(body: Record<string, unknown> | null): string | undefined {
  return typeof body?.etag === 'string' && body.etag ? body.etag : undefined;
}
