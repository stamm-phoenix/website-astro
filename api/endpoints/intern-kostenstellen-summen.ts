import { app } from '@azure/functions';
import { readKostenstellenSummen } from '../lib/kostenstellen';
import { getKostenstellenSummen, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { hasTeam } from '../lib/staff-auth';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

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
const getInternKostenstellenSummen: StaffRequestHandler = async (request, _context, principal) => {
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
};

export const GetInternKostenstellenSummenEndpoint = staffHandler(
  'kostenstellen-summen',
  getInternKostenstellenSummen
);

export default GetInternKostenstellenSummenEndpoint;

app.http('internKostenstellenSummen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/kostenstellen/summen',
  handler: GetInternKostenstellenSummenEndpoint,
});
