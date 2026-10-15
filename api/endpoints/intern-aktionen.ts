import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getAktionenOhneZuschuss } from '../lib/aktion-zuschuss';
import { getCampflowEvents } from '../lib/campflow';
import type { CampflowEvent } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** A CampFlow event with whether the KJR grant is applied for it. */
export interface InternAktion extends CampflowEvent {
  zuschussfaehig: boolean;
}

/** All CampFlow events for the Leitendenbereich, with whether they get the KJR grant. */
export async function GetInternAktionenEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  let events: CampflowEvent[];
  try {
    events = await getCampflowEvents();
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
  const ohne = await getAktionenOhneZuschuss();
  const body: InternAktion[] = events.map((event) => ({
    ...event,
    zuschussfaehig: !ohne.has(event.id),
  }));
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: body };
}

export default withErrorHandling(GetInternAktionenEndpoint);
