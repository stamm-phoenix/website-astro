import { app } from '@azure/functions';
import { readAktionBeitraege } from '../lib/beitraege';
import { CAMPFLOW_EVENT_ID_PATTERN } from '../lib/campflow';
import { getAktionBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * The Beiträge of the participants of a CampFlow event, per person, read-only. The Playwright
 * API serves its last read; `?refresh=true` reads CampFlow again.
 */
const getInternAktionBeitraege: StaffRequestHandler = async (request) => {
  const id = request.params.id ?? '';
  if (!CAMPFLOW_EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }

  try {
    const beitraege = readAktionBeitraege(
      await getAktionBeitraege(id, { refresh: request.query.get('refresh') === 'true' })
    );
    // Never the Beiträge of another Aktion under this one's name
    if (beitraege.eventId !== id) throw new PlaywrightApiError(502, 'Beiträge of another event');
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: beitraege };
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    if (error.status === 404) {
      return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es in CampFlow nicht (mehr).');
    }
    if (error.status === 503) {
      return errorResponse(
        502,
        'BEITRAEGE_UNAVAILABLE',
        'Für die Beiträge ist kein CampFlow-Zugang eingerichtet. Bitte melde dich bei admin@stamm-phoenix.de.'
      );
    }
    return errorResponse(
      502,
      'BEITRAEGE_UNAVAILABLE',
      'Die Beiträge der Teilnehmenden konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
};

export const GetInternAktionBeitraegeEndpoint = staffHandler(
  'aktion-beitraege',
  getInternAktionBeitraege
);

export default GetInternAktionBeitraegeEndpoint;

app.http('internAktionBeitraege', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/aktionen/{id}/beitraege',
  handler: GetInternAktionBeitraegeEndpoint,
});
