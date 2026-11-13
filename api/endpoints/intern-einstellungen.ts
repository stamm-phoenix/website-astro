import { app, type HttpRequest } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { validateStaffSettings } from '../lib/validation/staff';
import { readJsonBody } from '../lib/response-utils';
import { getStaffSettings, saveStaffSettings } from '../lib/staff-settings';
import { staffHandler } from '../lib/handler';

/**
 * The settings of the logged-in person (`staff-settings-model.ts`). GET: `{ settings }`, an
 * empty object if never saved; PUT `{ settings }`: merges the given keys into the saved ones
 * and answers with the result. Each person only reaches their own. Quiet, because a choice is
 * saved as soon as it is made.
 */
export const StaffSettings = staffHandler(
  'einstellungen',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      return ok({ settings: await getStaffSettings(principal.userId) });
    }
    const changes = validateStaffSettings(await readJsonBody(request));
    return ok({
      settings: await saveStaffSettings(principal.userId, principal.userDetails, changes),
    });
  },
  { quiet: true }
);

app.http('internEinstellungen', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/einstellungen',
  handler: StaffSettings,
});
