import type { HttpRequest } from '@azure/functions';
import { METHOD_NOT_ALLOWED, ok, pflegeHandler } from '../lib/pflege-api';
import { getIch } from '../lib/personen';
import { withErrorHandling } from '../lib/response-utils';

/**
 * GET: the logged-in person and their CampFlow person from the module „Personen“, so pages can
 * mark own entries with „(ich)“ (`docs/personen.md`). `campflow` is `null` without a link.
 */
export const IchEndpoint = pflegeHandler(
  'ich',
  async (request: HttpRequest, _context, principal) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    return ok(await getIch(principal.userDetails.toLowerCase()));
  }
);

export const Ich = withErrorHandling(IchEndpoint);
