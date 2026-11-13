import { app, type HttpRequest } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { validateChangelogSeen } from '../lib/validation/staff';
import { readJsonBody } from '../lib/response-utils';
import { getChangelogSeen, saveChangelogSeen } from '../lib/staff-changelog';
import { staffHandler } from '../lib/handler';

/**
 * The newest changelog entry the logged-in person has seen. GET: `{ lastSeenId }`, `null` before
 * the first save; PUT `{ lastSeenId }`: remembers it, never going back to an older one, and
 * answers with the ID that applies. Each person only reaches their own. Quiet, because opening
 * the changelog saves it on its own.
 */
export const StaffChangelog = staffHandler(
  'neuigkeiten',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      return ok({ lastSeenId: await getChangelogSeen(principal.userId) });
    }
    const id = validateChangelogSeen(await readJsonBody(request));
    return ok({ lastSeenId: await saveChangelogSeen(principal.userId, principal.userDetails, id) });
  },
  { quiet: true }
);

app.http('internNeuigkeiten', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/neuigkeiten',
  handler: StaffChangelog,
});
