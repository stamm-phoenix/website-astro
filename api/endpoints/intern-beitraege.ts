import { app } from '@azure/functions';
import { readBeitraege } from '../lib/beitraege';
import { getBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * All Sammlungen and Beiträge from CampFlow with who has paid, read-only. The Playwright API
 * serves its last read; `?refresh=true` reads CampFlow again.
 */
const getInternBeitraege: StaffRequestHandler = async (request) => {
  try {
    const beitraege = readBeitraege(
      await getBeitraege({ refresh: request.query.get('refresh') === 'true' })
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: beitraege };
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
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
      'Die Beiträge konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
};

export const GetInternBeitraegeEndpoint = staffHandler('beitraege', getInternBeitraege);

export default GetInternBeitraegeEndpoint;

app.http('internBeitraege', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/beitraege',
  handler: GetInternBeitraegeEndpoint,
});
