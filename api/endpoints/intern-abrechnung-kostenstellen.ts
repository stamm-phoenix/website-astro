import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { getKostenstellen, playwrightErrorResponse } from '../lib/playwright-api';
import { withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/**
 * All Kostenstellen from CampFlow, to pick one when an Aktion's title matches none. The
 * Playwright API serves its last read; `?refresh=true` reads CampFlow again.
 */
export async function GetInternAbrechnungKostenstellenEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  try {
    const refresh = request.query.get('refresh') === 'true';
    const kostenstellen = (await getKostenstellen({ refresh })).sort(
      (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: kostenstellen };
  } catch (error: unknown) {
    return playwrightErrorResponse(error);
  }
}

const defaultHandler = withErrorHandling(GetInternAbrechnungKostenstellenEndpoint);
export default defaultHandler;

// Not under `intern/abrechnung/`: the host sends that path to `intern/abrechnung/{id}`, whatever
// the order of registration
app.http('internKostenstellen', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/kostenstellen',
  handler: defaultHandler,
});
