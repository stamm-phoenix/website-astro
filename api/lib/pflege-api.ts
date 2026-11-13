import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { NO_STORE_HEADERS, errorResponse } from './response-utils';
import { ValidationError } from './validation/errors';

/** The answers the staff endpoints share; their pipeline is `staffHandler` (`handler.ts`). */

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

/** The etag a bodyless or binary request (delete, photo upload) sends in `If-Match`. */
export function readIfMatch(request: HttpRequest): string | undefined {
  return request.headers.get('if-match') || undefined;
}

/** The `etag` from a request body, if present. */
export function readEtag(body: Record<string, unknown> | null): string | undefined {
  return typeof body?.etag === 'string' && body.etag ? body.etag : undefined;
}

/**
 * Requires the etag the client loaded (an HTTP entity tag, e.g. `"…"` or `W/"…"`), preventing
 * unconditional updates or deletes; a missing one is invalid input (400). The database's own
 * check is `requireRowversion` (`db.ts`).
 */
export function requireEtag(etag: string | undefined): string {
  const version = etag?.trim();
  if (!version || !/^(?:W\/)?"[^"\r\n]+"$/.test(version)) {
    throw new ValidationError({
      etag: 'Die Version des Eintrags fehlt. Bitte schließen, neu laden und erneut bearbeiten.',
    });
  }
  return version;
}
