import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { withServerTiming } from './server-timing';
import type { ClientPrincipal } from './staff-auth';
import { isStaffError, requireStaff } from './staff-auth';
import { MaintenanceError, getErrorStatus, maintenanceResponse } from './response-utils';
import { CONFLICT, NOT_FOUND } from './pflege-api';
import { ValidationError } from './validation/errors';
import { requestSiteRebuild } from './site-rebuild';

/**
 * The pipeline of every endpoint: `publicHandler` for anonymous routes and `staffHandler` for
 * everything under `/api/intern/*`. Both answer an unexpected error with a 500 and add
 * `Server-Timing` to internal requests.
 */

export type EndpointHandler = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

export type StaffRequestHandler = (
  request: HttpRequest,
  context: InvocationContext,
  principal: ClientPrincipal
) => Promise<HttpResponseInit>;

interface PublicHandlerOptions {
  exposeErrorDetails?: boolean;
}

/** Answers an unexpected error with a 500 after logging it. */
async function catchUnexpected(
  context: InvocationContext,
  work: () => Promise<HttpResponseInit>,
  options?: PublicHandlerOptions
): Promise<HttpResponseInit> {
  try {
    return await work();
  } catch (error: unknown) {
    context.error(error);
    if (!options?.exposeErrorDetails) {
      return { status: 500, jsonBody: { error: 'Error', message: 'Internal Server Error' } };
    }
    return {
      status: 500,
      jsonBody: {
        error: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Requests of the Leitendenbereich report their timings; public ones do not. */
function timed(request: HttpRequest, work: () => Promise<HttpResponseInit>) {
  return new URL(request.url).pathname.startsWith('/api/intern/') ? withServerTiming(work) : work();
}

/** The pipeline of an anonymous route: a 500 for unexpected errors, nothing else. */
export function publicHandler(
  handler: EndpointHandler,
  options?: PublicHandlerOptions
): EndpointHandler {
  return (request, context) =>
    timed(request, () => catchUnexpected(context, () => handler(request, context), options));
}

/**
 * A rule of one area that a staff request passes before its handler, passed in by the area's
 * own module (`nikolausGate` in `nikolaus-staff.ts`, `protokollGate` in `protokoll-cutover.ts`).
 */
export interface StaffGate {
  /**
   * Runs after the login check: an answer that replaces the handler's, or `undefined` to go on.
   * Errors it throws are mapped like the handler's.
   */
  check?(request: HttpRequest): Promise<HttpResponseInit | undefined>;
  /** Runs the handler, e.g. while holding a lock. */
  run?(work: () => Promise<HttpResponseInit>): Promise<HttpResponseInit>;
  /** Whether every answer after the login check gets `Cache-Control: no-store`, a 500 too. */
  noStore?(request: HttpRequest): boolean;
}

export interface StaffHandlerOptions {
  gate?: StaffGate;
  /**
   * Skips the log line of successful writes, for requests a page sends every few seconds
   * (autosave, renewing a lock); the endpoint logs the changes that matter itself.
   */
  quiet?: boolean;
  /** A POST that changes nothing (a list, a check): no log line and no website build. */
  readOnly?: boolean;
}

/**
 * Maps the errors every staff endpoint shares: a maintenance mode (503), invalid input (400),
 * missing entries (404) and lost races (409, from a status 409 or 412 such as
 * `VersionConflictError` or a Graph `If-Match`). Others are rethrown.
 */
export function toErrorResponse(error: unknown): HttpResponseInit {
  if (error instanceof MaintenanceError) return maintenanceResponse(error);
  if (error instanceof ValidationError) {
    return {
      status: 400,
      jsonBody: { error: 'INVALID', code: 'INVALID', message: error.message, fields: error.fields },
    };
  }
  const status = getErrorStatus(error);
  if (status === 404) return NOT_FOUND;
  if (status === 409 || status === 412) return CONFLICT;
  throw error;
}

function withNoStore(response: HttpResponseInit): HttpResponseInit {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return { ...response, headers: Object.fromEntries(headers.entries()) };
}

/**
 * The pipeline of every `/api/intern/*` endpoint: requires a logged-in staff member, applies the
 * area's gate, maps the shared errors and logs every change with the acting user, because the
 * database only knows the app. Changes to public content trigger a website build.
 */
export function staffHandler(
  area: string,
  handler: StaffRequestHandler,
  options: StaffHandlerOptions = {}
): EndpointHandler {
  const { gate, quiet = false, readOnly = false } = options;
  const invoke = async (
    request: HttpRequest,
    context: InvocationContext,
    principal: ClientPrincipal
  ): Promise<HttpResponseInit> => {
    try {
      const refused = await gate?.check?.(request);
      if (refused) return refused;
      const work = () => handler(request, context, principal);
      const response = gate?.run ? await gate.run(work) : await work();
      if (!readOnly && request.method !== 'GET' && (response.status ?? 200) < 400) {
        if (!quiet) {
          context.log(
            `[pflege] ${principal.userDetails} ${request.method} ${area} ${request.params.id ?? ''}`.trim()
          );
        }
        // The public pages are baked at build time; changes to their content start a build
        await requestSiteRebuild(area, context);
      }
      return response;
    } catch (error: unknown) {
      return toErrorResponse(error);
    }
  };
  return (request, context) =>
    timed(request, () =>
      catchUnexpected(context, async () => {
        const principal = requireStaff(request);
        if (isStaffError(principal)) return principal;
        if (!gate?.noStore?.(request)) return invoke(request, context, principal);
        // Keeps the header on unexpected errors too
        return withNoStore(
          await catchUnexpected(context, () => invoke(request, context, principal))
        );
      })
    );
}
