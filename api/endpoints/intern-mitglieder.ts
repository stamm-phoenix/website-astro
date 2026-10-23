import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { CampflowColumn } from '../lib/campflow';
import { CampflowError, campflowGetAll, getCampflowMembers, sanitizePerson } from '../lib/campflow';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/** Custom fields of the member list; without them the fields only lose their names. */
async function memberColumns(): Promise<CampflowColumn[]> {
  try {
    return await campflowGetAll<CampflowColumn>('/lists/member/custom_columns');
  } catch (error: unknown) {
    if (error instanceof CampflowError && error.status !== 401 && error.status !== 403) return [];
    throw error;
  }
}

/**
 * The CampFlow member list with its custom fields, read-only for all Leitende
 * (`docs/mitglieder.md`). Payment details stay on the server.
 */
export async function GetInternMitgliederEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  try {
    const [persons, columns] = await Promise.all([getCampflowMembers(), memberColumns()]);
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        loadedAt: new Date().toISOString(),
        columns,
        persons: persons.filter((person) => typeof person.id === 'string').map(sanitizePerson),
      },
    };
  } catch (error: unknown) {
    if (!(error instanceof CampflowError)) throw error;
    if (error.status === 401 || error.status === 402 || error.status === 403) {
      return errorResponse(
        502,
        'CAMPFLOW_FORBIDDEN',
        'Die Mitgliederliste ist für die Website in CampFlow nicht freigegeben. Bitte melde dich bei admin@stamm-phoenix.de.'
      );
    }
    return errorResponse(
      502,
      'CAMPFLOW_UNAVAILABLE',
      'Die Mitgliederliste konnte nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
}

export default withErrorHandling(GetInternMitgliederEndpoint);
