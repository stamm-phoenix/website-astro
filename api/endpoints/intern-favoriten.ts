import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, NO_CONTENT, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateStaffFavorites } from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import { getStaffFavorites, saveStaffFavorites } from '../lib/staff-favorites';

/**
 * The favorites of the logged-in person on the start page of the Leitendenbereich. GET:
 * `{ modules }`, `null` if never saved; PUT `{ modules }`: replaces them. Each person only
 * reaches their own. Quiet, because every tick of a checkbox saves.
 */
export const StaffFavoritesEndpoint = pflegeHandler(
  'favoriten',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') return ok({ modules: await getStaffFavorites(principal.userId) });
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const modules = validateStaffFavorites(await readJsonBody(request));
    await saveStaffFavorites(principal.userId, principal.userDetails, modules);
    return NO_CONTENT;
  },
  { quiet: true }
);

export const StaffFavorites = withErrorHandling(StaffFavoritesEndpoint);
