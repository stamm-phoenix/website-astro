import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { isBelegReviewer } from '../lib/beleg-rechte';
import { parseId } from '../lib/db';
import { NOT_FOUND, ok, readEtag, requireEtag } from '../lib/pflege-api';
import { errorResponse, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { BelegCampflowError, transferBelegToCampflow } from '../lib/beleg-campflow';
import { readCampflowBelege } from '../lib/campflow-belege';
import { getCampflowBelege, PlaywrightApiError } from '../lib/playwright-api';
import { staffHandler } from '../lib/handler';
import { FORBIDDEN, ownNames } from '../lib/belege-http';

/**
 * POST: transfers an accepted receipt to CampFlow (the `etag` of the receipt in the body), booked
 * on its Kostenstelle and Kategorie, and deletes it afterwards; see `beleg-campflow.ts`. Kasse
 * only.
 */
export const BelegCampflow = staffHandler(
  'belege-campflow',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (!isBelegReviewer(principal)) return FORBIDDEN;

    const body = await readJsonBody(request);
    const etag = requireEtag(readEtag(body));
    try {
      return ok(
        await transferBelegToCampflow(id, etag, principal.userDetails, Date.now() + 40_000)
      );
    } catch (error: unknown) {
      if (error instanceof BelegCampflowError) return error.toResponse();
      throw error;
    }
  }
);

/**
 * GET: every receipt in CampFlow with its booking and payment state, read-only and for every
 * leader, like the Beiträge. The Playwright API serves its last read; `?refresh=true` reads
 * CampFlow again. Receipts transferred from here carry who submitted them, as a flag for the user.
 */
export const BelegeCampflow = staffHandler(
  'belege-campflow-liste',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    try {
      const belege = await readCampflowBelege(
        await getCampflowBelege({ refresh: request.query.get('refresh') === 'true' }),
        principal.userDetails,
        await ownNames(principal)
      );
      return { status: 200, headers: NO_STORE_HEADERS, jsonBody: belege };
    } catch (error: unknown) {
      if (!(error instanceof PlaywrightApiError)) throw error;
      if (error.status === 503) {
        return errorResponse(
          502,
          'CAMPFLOW_BELEGE_UNAVAILABLE',
          'Für die Belege aus CampFlow ist kein CampFlow-Zugang eingerichtet. Bitte melde dich bei admin@stamm-phoenix.de.'
        );
      }
      return errorResponse(
        502,
        'CAMPFLOW_BELEGE_UNAVAILABLE',
        'Die Belege konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
      );
    }
  }
);

/** GET: whether the user belongs to the Kasse, so the page can show the review controls. */
export const BelegRolle = staffHandler(
  'belege-rolle',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    return ok({ reviewer: isBelegReviewer(principal) });
  }
);

// Registered before `belege/{id}` as well
app.http('internPflegeBelegeCampflow', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/campflow',
  handler: BelegeCampflow,
});

app.http('internPflegeBelegRolle', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/rolle',
  handler: BelegRolle,
});

app.http('internPflegeBelegCampflow', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/campflow',
  handler: BelegCampflow,
});
