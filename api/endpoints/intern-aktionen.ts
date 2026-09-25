import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getCampflowEvents } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** All CampFlow events for the Leitendenbereich. */
export async function GetInternAktionenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  try {
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await getCampflowEvents() };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

export default withErrorHandling(GetInternAktionenEndpoint);
