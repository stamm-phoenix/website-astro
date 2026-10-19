import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { AktionArt } from '../lib/aktion-art';
import { withAktionArt } from '../lib/aktion-art';
import { getCampflowEvents } from '../lib/campflow';
import type { CampflowEvent } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** A CampFlow event with whether it is a real Aktion and gets the KJR grant. */
export interface InternAktion extends CampflowEvent, AktionArt {}

/** All CampFlow events for the Leitendenbereich, with whether they are Aktionen and get the grant. */
export async function GetInternAktionenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  let events: CampflowEvent[];
  try {
    events = await getCampflowEvents();
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
  const body: InternAktion[] = await withAktionArt(events);
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
}

export default withErrorHandling(GetInternAktionenEndpoint);
