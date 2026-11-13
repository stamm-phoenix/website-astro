import { app, type HttpRequest } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { validateStaffRecentVisit } from '../lib/validation/staff';
import { readJsonBody } from '../lib/response-utils';
import { addStaffRecent, getStaffRecent } from '../lib/staff-recent';
import { staffHandler } from '../lib/handler';

/**
 * The areas of the Leitendenbereich the logged-in person opened last. GET: `{ modules }`, the
 * latest first; POST `{ module }`: puts that module first and answers with the new list. Each
 * person only reaches their own. Quiet, because every opening of a module records it.
 */
export const StaffRecent = staffHandler(
  'zuletzt',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok({ modules: await getStaffRecent(principal.userId) });
    const module = validateStaffRecentVisit(await readJsonBody(request));
    return ok({
      modules: await addStaffRecent(principal.userId, principal.userDetails, module),
    });
  },
  { quiet: true }
);

app.http('internZuletzt', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/zuletzt',
  handler: StaffRecent,
});
