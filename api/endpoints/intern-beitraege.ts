import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { readBeitraege } from '../lib/beitraege';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { getBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/**
 * All Sammlungen and Beiträge from CampFlow with who has paid, read-only. The Playwright API
 * serves its last read; `?refresh=true` reads CampFlow again.
 */
export async function GetInternBeitraegeEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  try {
    const beitraege = readBeitraege(
      await getBeitraege({ refresh: request.query.get('refresh') === 'true' })
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: beitraege };
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    if (error.status === 503) {
      return errorResponse(
        502,
        'BEITRAEGE_UNAVAILABLE',
        'Für die Beiträge ist kein CampFlow-Zugang eingerichtet. Bitte melde dich bei admin@stamm-phoenix.de.'
      );
    }
    return errorResponse(
      502,
      'BEITRAEGE_UNAVAILABLE',
      'Die Beiträge konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
}

export default withErrorHandling(GetInternBeitraegeEndpoint);
