import { app, type HttpRequest } from '@azure/functions';
import { NO_CONTENT, ok } from '../lib/pflege-api';
import { validateStaffFavorites } from '../lib/validation/staff';
import { readJsonBody } from '../lib/response-utils';
import {
  getStaffFavorites,
  saveStaffFavorites,
  takeOverStaffFavorites,
} from '../lib/staff-favorites';
import { staffHandler } from '../lib/handler';

/**
 * The favorites of the logged-in person on the start page of the Leitendenbereich. GET:
 * `{ modules }`, `null` if never saved; PUT `{ modules }`: replaces them. PUT `{ modules,
 * takeover: true }` saves favorites from the browser only if none are saved yet and answers with
 * the favorites that apply. Each person only reaches their own. Quiet, because every tick of a checkbox saves.
 */
export const StaffFavorites = staffHandler(
  'favoriten',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok({ modules: await getStaffFavorites(principal.userId) });
    const body = await readJsonBody(request);
    const modules = validateStaffFavorites(body);
    if (body?.takeover === true) {
      return ok({
        modules: await takeOverStaffFavorites(principal.userId, principal.userDetails, modules),
      });
    }
    await saveStaffFavorites(principal.userId, principal.userDetails, modules);
    return NO_CONTENT;
  },
  { quiet: true }
);

app.http('internFavoriten', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/favoriten',
  handler: StaffFavorites,
});
