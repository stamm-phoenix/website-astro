import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { CampflowColumn, CampflowPerson } from '../lib/campflow';
import { campflowGetAll, getCampflowEvents, sanitizePerson } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;

/** A single CampFlow event with its custom fields and participants. */
export async function GetInternAktionEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }

  try {
    const listPath = `/lists/${encodeURIComponent(id)}`;
    const [events, columns, persons] = await Promise.all([
      getCampflowEvents(),
      campflowGetAll<CampflowColumn>(`${listPath}/custom_columns`),
      campflowGetAll<CampflowPerson>(`${listPath}/persons`),
    ]);

    const event = events.find((e) => e.id === id);
    if (!event) {
      return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
    }

    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: { event, columns, persons: persons.map(sanitizePerson) },
    };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

export default withErrorHandling(GetInternAktionEndpoint);
