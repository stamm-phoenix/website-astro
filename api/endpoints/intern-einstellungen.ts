import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateStaffSettings } from '../lib/validation/staff';
import { withErrorHandling } from '../lib/response-utils';
import { getStaffSettings, saveStaffSettings } from '../lib/staff-settings';

/**
 * The settings of the logged-in person (`staff-settings-model.ts`). GET: `{ settings }`, an
 * empty object if never saved; PUT `{ settings }`: merges the given keys into the saved ones
 * and answers with the result. Each person only reaches their own. Quiet, because a choice is
 * saved as soon as it is made.
 */
export const StaffSettingsEndpoint = pflegeHandler(
  'einstellungen',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      return ok({ settings: await getStaffSettings(principal.userId) });
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const changes = validateStaffSettings(await readJsonBody(request));
    return ok({
      settings: await saveStaffSettings(principal.userId, principal.userDetails, changes),
    });
  },
  { quiet: true }
);

export const StaffSettings = withErrorHandling(StaffSettingsEndpoint);
