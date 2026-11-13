import { app } from '@azure/functions';
import type { CampflowColumn, CampflowPerson } from '../lib/campflow';
import {
  CAMPFLOW_EVENT_ID_PATTERN,
  campflowGetAll,
  getCampflowEvents,
  sanitizePerson,
} from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { getAktionArt } from '../lib/aktion-art';
import { eigeneAnmeldungen } from '../lib/personen';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/** A single CampFlow event with its custom fields, participants and the own registrations. */
const getInternAktion: StaffRequestHandler = async (request, _context, principal) => {
  const id = request.params.id ?? '';
  if (!CAMPFLOW_EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }

  try {
    const listPath = `/lists/${encodeURIComponent(id)}`;
    const [events, columns, persons, art] = await Promise.all([
      getCampflowEvents(),
      campflowGetAll<CampflowColumn>(`${listPath}/custom_columns`),
      campflowGetAll<CampflowPerson>(`${listPath}/persons`),
      getAktionArt(id),
    ]);

    const event = events.find((e) => e.id === id);
    if (!event) {
      return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
    }

    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        event: { ...event, ...art },
        columns,
        persons: persons.map(sanitizePerson),
        // Own registrations, matched by address on the server for „(ich)“ (docs/personen.md)
        ich: await eigeneAnmeldungen(principal.userDetails, persons),
      },
    };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
};

export const GetInternAktionEndpoint = staffHandler('aktion', getInternAktion);

export default GetInternAktionEndpoint;

app.http('internAktion', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen/{id}',
  handler: GetInternAktionEndpoint,
});
