import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateAbstimmungName } from '../lib/abstimmung-model';
import {
  AbstimmungClosedError,
  getAbstimmungAnsicht,
  isAbstimmungToken,
  votePublic,
} from '../lib/abstimmungen';
import { RecordNotFoundError } from '../lib/db';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { ValidationError } from '../lib/pflege-validation';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/**
 * The public side of the Abstimmungen (`docs/abstimmungen.md`): the shared link (`link`) and
 * the personal links (`token`) work without a login. The tokens travel in the body, never in
 * the URL of a request.
 */

const INVALID_LINK = errorResponse(
  404,
  'INVALID_LINK',
  'Dieser Link ist ungültig oder die Abstimmung wurde gelöscht. Bitte verwende den vollständigen Link aus deiner Einladung.'
);
const CLOSED = errorResponse(
  409,
  'CLOSED',
  'Diese Abstimmung ist beendet. Du kannst nicht mehr abstimmen.'
);

function linkOf(body: Record<string, unknown> | null): { link?: string; token?: string } {
  if (isAbstimmungToken(body?.token)) return { token: body.token };
  if (isAbstimmungToken(body?.link)) return { link: body.link };
  return {};
}

/** Maps the module's errors and adds no-store to every response. */
function publicHandler(
  handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>
): (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> {
  const safe = withErrorHandling(async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      if (error instanceof AbstimmungClosedError) return CLOSED;
      if (error instanceof RecordNotFoundError) return INVALID_LINK;
      if (error instanceof ValidationError) {
        return {
          status: 400,
          jsonBody: { code: 'INVALID', message: error.message, fields: error.fields },
        };
      }
      throw error;
    }
  });
  return async (request, context) => {
    const response = await safe(request, context);
    return { ...response, headers: { ...response.headers, ...NO_STORE_HEADERS } };
  };
}

/** POST `{ link }` or `{ token }`: the Abstimmung with its result and the own answer. */
export const AbstimmungAnsehen = publicHandler(async (request) => {
  const link = linkOf(await readJsonBody(request));
  const ansicht = link.link || link.token ? await getAbstimmungAnsicht(link) : undefined;
  return ansicht ? { status: 200, jsonBody: ansicht } : INVALID_LINK;
});

/**
 * PUT `{ link | token, name, gewaehlt }`: saves the answer. Over the shared link a new person is
 * added; the answer carries the personal link token, so the page can change the answer later.
 */
export const AbstimmungAbstimmen = publicHandler(async (request) => {
  const body = await readJsonBody(request);
  const link = linkOf(body);
  if (!link.link && !link.token) return INVALID_LINK;
  const name = validateAbstimmungName(body?.name);
  const result = await votePublic(link, name, body?.gewaehlt);
  return result ? { status: 200, jsonBody: result } : INVALID_LINK;
});
