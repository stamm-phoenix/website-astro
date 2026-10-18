import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateStaffRecentVisit } from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import { addStaffRecent, getStaffRecent } from '../lib/staff-recent';

/**
 * The areas of the Leitendenbereich the logged-in person opened last. GET: `{ modules }`, the
 * latest first; POST `{ module }`: puts that module first and answers with the new list. Each
 * person only reaches their own. Quiet, because every opening of a module records it.
 */
export const StaffRecentEndpoint = pflegeHandler(
  'zuletzt',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok({ modules: await getStaffRecent(principal.userId) });
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const module = validateStaffRecentVisit(await readJsonBody(request));
    return ok({
      modules: await addStaffRecent(principal.userId, principal.userDetails, module),
    });
  },
  { quiet: true }
);

export const StaffRecent = withErrorHandling(StaffRecentEndpoint);
