import { app } from '@azure/functions';
import { getKostenstellen, playwrightErrorResponse } from '../lib/playwright-api';
import { NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * All Kostenstellen from CampFlow, to pick one when an Aktion's title matches none. The
 * Playwright API serves its last read; `?refresh=true` reads CampFlow again.
 */
const getInternAbrechnungKostenstellen: StaffRequestHandler = async (request) => {
  try {
    const refresh = request.query.get('refresh') === 'true';
    const kostenstellen = (await getKostenstellen({ refresh })).sort(
      (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: kostenstellen };
  } catch (error: unknown) {
    return playwrightErrorResponse(error);
  }
};

export const GetInternAbrechnungKostenstellenEndpoint = staffHandler(
  'kostenstellen',
  getInternAbrechnungKostenstellen
);

export default GetInternAbrechnungKostenstellenEndpoint;

// Not under `intern/abrechnung/`: the host sends that path to `intern/abrechnung/{id}`, whatever
// the order of registration
app.http('internKostenstellen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/kostenstellen',
  handler: GetInternAbrechnungKostenstellenEndpoint,
});
