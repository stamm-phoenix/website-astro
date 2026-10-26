import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { readKostenstellenSummen } from '../lib/kostenstellen';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { getKostenstellenSummen, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { hasTeam, isStaffError, requireStaff } from '../lib/staff-auth';

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die Kostenstellen sehen nur die Kasse und der Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

/**
 * The sums of income and expenses per CampFlow Kostenstelle and Kategorie, read-only and only for
 * the teams Kasse and Vorstand. The Playwright API serves its last export; `?refresh=true`
 * exports CampFlow's report again.
 */
export async function GetInternKostenstellenSummenEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (!hasTeam(principal, 'kasse') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;

  try {
    const uebersicht = readKostenstellenSummen(
      await getKostenstellenSummen({ refresh: request.query.get('refresh') === 'true' })
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: uebersicht };
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    if (error.status === 503) {
      return errorResponse(
        502,
        'KOSTENSTELLEN_UNAVAILABLE',
        'Für die Kostenstellen ist kein CampFlow-Zugang eingerichtet. Bitte melde dich bei admin@stamm-phoenix.de.'
      );
    }
    return errorResponse(
      502,
      'KOSTENSTELLEN_UNAVAILABLE',
      'Die Kostenstellen konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
}

export default withErrorHandling(GetInternKostenstellenSummenEndpoint);
