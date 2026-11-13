import { app } from '@azure/functions';
import { offeneBeitraege, readBeitraege } from '../lib/beitraege';
import { EIGENE_BEITRAEGE_TIMEOUT_MS, eigeneBeitraege } from '../lib/personen';
import { getBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, NO_STORE_HEADERS } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * The whole request stays this far below the time limit of Static Web Apps (45 seconds): after a
 * slow Playwright API, the own Beiträge are found by the names rather than waiting any longer.
 */

/**
 * The Beiträge with something left to do (open or paid too much) for the start page, and `ich`:
 * per Beitrag whether it is the logged-in person's own, as far as the server could check it
 * (`eigeneBeitraege`, `docs/personen.md`); the page decides the rest by the payer's name.
 */
const getInternBeitraegeMeine: StaffRequestHandler = async (request, _context, principal) => {
  const started = Date.now();
  try {
    const { loadedAt, batches, fees } = offeneBeitraege(readBeitraege(await getBeitraege()));
    const sammlungen = new Map(batches.map((batch) => [batch.id, batch]));
    const ich = await eigeneBeitraege(
      principal.userDetails,
      fees.map((fee) => ({
        id: fee.id,
        payerId: fee.payerId,
        eventId: (fee.batchId && sammlungen.get(fee.batchId)?.eventId) || null,
        mitgliedsbeitrag: !!fee.batchId && sammlungen.get(fee.batchId)?.type === 'annuity',
      })),
      Math.min(started + 40_000, Date.now() + EIGENE_BEITRAEGE_TIMEOUT_MS)
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { loadedAt, batches, fees, ich } };
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
      'Deine Beiträge konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
    );
  }
};

export const GetInternBeitraegeMeineEndpoint = staffHandler(
  'beitraege-meine',
  getInternBeitraegeMeine
);

export default GetInternBeitraegeMeineEndpoint;

app.http('internBeitraegeMeine', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/beitraege/meine',
  handler: GetInternBeitraegeMeineEndpoint,
});
