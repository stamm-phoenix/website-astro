import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { validateChangelogSeen } from '../lib/validation/staff';
import { withErrorHandling } from '../lib/response-utils';
import { getChangelogSeen, saveChangelogSeen } from '../lib/staff-changelog';

/**
 * The newest changelog entry the logged-in person has seen. GET: `{ lastSeenId }`, `null` before
 * the first save; PUT `{ lastSeenId }`: remembers it, never going back to an older one, and
 * answers with the ID that applies. Each person only reaches their own. Quiet, because opening
 * the changelog saves it on its own.
 */
export const StaffChangelogEndpoint = pflegeHandler(
  'neuigkeiten',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      return ok({ lastSeenId: await getChangelogSeen(principal.userId) });
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const id = validateChangelogSeen(await readJsonBody(request));
    return ok({ lastSeenId: await saveChangelogSeen(principal.userId, principal.userDetails, id) });
  },
  { quiet: true }
);

export const StaffChangelog = withErrorHandling(StaffChangelogEndpoint);
