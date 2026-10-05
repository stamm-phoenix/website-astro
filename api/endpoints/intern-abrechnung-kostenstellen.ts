import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { getKostenstellen, playwrightErrorResponse } from '../lib/playwright-api';
import { withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/** All Kostenstellen from CampFlow, to pick one when an Aktion's title matches none. */
export async function GetInternAbrechnungKostenstellenEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  try {
    const kostenstellen = (await getKostenstellen()).sort(
      (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de')
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: kostenstellen };
  } catch (error: unknown) {
    return playwrightErrorResponse(error);
  }
}

export default withErrorHandling(GetInternAbrechnungKostenstellenEndpoint);
