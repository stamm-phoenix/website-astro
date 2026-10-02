import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from './staff-auth';
import { isStaffError, requireStaff } from './staff-auth';
import { NO_STORE_HEADERS, nikolausMaintenanceResponse, readJsonBody } from './nikolaus-api';
import { errorResponse, withErrorHandling } from './response-utils';
import { getGraphStatus } from './sharepoint-data-access';
import { SharePointRestError } from './sharepoint-rest';
import { ValidationError } from './pflege-validation';
import { NikolausStateConflictError, NikolausStateSizeError } from './nikolaus-state';
import { NikolausMaintenanceError, runWithNikolausWriteGate } from './nikolaus-write-gate';

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
  if (error instanceof NikolausMaintenanceError) return nikolausMaintenanceResponse(error);
  if (error instanceof NikolausStateConflictError) return CONFLICT;
  if (error instanceof NikolausStateSizeError)
    return errorResponse(413, 'SIZE_LIMIT', error.message);
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

    const gated = area.startsWith('nikolaus') && request.method !== 'GET';
    const markGate = (response: HttpResponseInit): HttpResponseInit => {
      if (!gated) return response;
      const headers = new Headers(response.headers);
      headers.set('X-Nikolaus-Write-Gate', 'v1');
      headers.set('Cache-Control', 'no-store');
      return { ...response, headers: Object.fromEntries(headers.entries()) };
    };
    const invoke = async (): Promise<HttpResponseInit> => {
      try {
        const response = gated
          ? await runWithNikolausWriteGate(() => handler(request, context, principal))
          : await handler(request, context, principal);
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
    // Keep the deployment marker and no-store header on unexpected gated errors too.
    return markGate(gated ? await withErrorHandling(invoke)(request, context) : await invoke());
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

/** Requires the loaded version, preventing unconditional updates or deletes. */
export function requireVersion(etag: string | undefined): string {
  const version = etag?.trim();
  if (!version || !/^(?:W\/)?"[^"\r\n]+"$/.test(version)) {
    throw new ValidationError({
      etag: 'Die Version des Eintrags fehlt. Bitte schließen, neu laden und erneut bearbeiten.',
    });
  }
  return version;
}
