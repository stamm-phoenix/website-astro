import { app, type HttpRequest } from '@azure/functions';
import { ok } from '../lib/pflege-api';
import { getIch } from '../lib/personen';
import { staffHandler } from '../lib/handler';

/**
 * GET: the logged-in person and their CampFlow person from the module „Personen“, so pages can
 * mark own entries with „(ich)“ (`docs/personen.md`). `campflow` is `null` without a link.
 */
export const Ich = staffHandler('ich', async (request: HttpRequest, _context, principal) => {
  return ok(await getIch(principal.userDetails.toLowerCase()));
});

app.http('internIch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/ich',
  handler: Ich,
});
