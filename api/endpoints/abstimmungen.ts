import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { validateAbstimmungName } from '../lib/abstimmung-schema';
import {
  AbstimmungClosedError,
  isAbstimmungToken,
  isAbstimmungVersuch,
} from '../lib/abstimmungen-basis';
import { getAbstimmungAnsicht, votePublic } from '../lib/abstimmungen-stimmen';
import { RecordNotFoundError } from '../lib/db';
import { ValidationError } from '../lib/validation/errors';
import { errorResponse, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { publicHandler } from '../lib/handler';

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
function linkHandler(
  handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>
): (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> {
  const safe = publicHandler(async (request, context) => {
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
export const AbstimmungAnsehen = linkHandler(async (request) => {
  const link = linkOf(await readJsonBody(request));
  const ansicht = link.link || link.token ? await getAbstimmungAnsicht(link) : undefined;
  return ansicht ? { status: 200, jsonBody: ansicht } : INVALID_LINK;
});

/**
 * PUT `{ link | token, name, gewaehlt, vielleicht?, versuch? }`: saves the answer. Over the shared link a new
 * person is added; the answer carries the personal link token, so the page can change the answer
 * later. `versuch` (a UUID per new answer) makes a repeated request find that person again.
 */
export const AbstimmungAbstimmen = linkHandler(async (request) => {
  const body = await readJsonBody(request);
  const link = linkOf(body);
  if (!link.link && !link.token) return INVALID_LINK;
  const name = validateAbstimmungName(body?.name);
  const versuch = isAbstimmungVersuch(body?.versuch) ? body.versuch : undefined;
  const result = await votePublic(
    link,
    name,
    { gewaehlt: body?.gewaehlt, vielleicht: body?.vielleicht },
    versuch
  );
  return result ? { status: 200, jsonBody: result } : INVALID_LINK;
});

// Abstimmungen: links with a token work without login; staff routes require Entra ID.
app.http('abstimmungAnsehen', {
  route: 'abstimmungen/ansehen',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: AbstimmungAnsehen,
});

app.http('abstimmungAbstimmen', {
  route: 'abstimmungen/stimme',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: AbstimmungAbstimmen,
});
