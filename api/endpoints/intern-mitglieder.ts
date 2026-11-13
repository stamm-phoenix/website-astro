import { app } from '@azure/functions';
import type { CampflowColumn, CampflowPerson } from '../lib/campflow';
import {
  CampflowError,
  campflowGetAll,
  getCampflowMembersWithTime,
  sanitizePerson,
} from '../lib/campflow';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * Fields of the member list that stay on the server on top of the payment details: health and
 * notes are sensitive and not needed to look up a member (the Aktionen still show them for their
 * participants).
 */
export const MITGLIED_REDACTED_FIELDS = ['health', 'intolerances', 'diet', 'notes'];

/** A member without payment details, health and notes. */
function toMitglied(person: CampflowPerson): CampflowPerson {
  const mitglied = sanitizePerson(person);
  for (const field of MITGLIED_REDACTED_FIELDS) delete mitglied[field];
  return mitglied;
}

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
 * (`docs/mitglieder.md`). Payment details, health and notes stay on the server. The list is shared with the other
 * modules for a minute; `?refresh=true` reads CampFlow again.
 */
const getInternMitglieder: StaffRequestHandler = async (request) => {
  try {
    const refresh = request.query.get('refresh') === 'true';
    const [{ value: persons, loadedAt }, columns] = await Promise.all([
      getCampflowMembersWithTime(refresh),
      memberColumns(),
    ]);
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        loadedAt: loadedAt.toISOString(),
        columns,
        persons: persons.filter((person) => typeof person.id === 'string').map(toMitglied),
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
};

export const GetInternMitgliederEndpoint = staffHandler('mitglieder', getInternMitglieder);

export default GetInternMitgliederEndpoint;

app.http('internMitglieder', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/mitglieder',
  handler: GetInternMitgliederEndpoint,
});
