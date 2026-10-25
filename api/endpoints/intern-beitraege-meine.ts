import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { offeneBeitraege, readBeitraege } from '../lib/beitraege';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { EIGENE_BEITRAEGE_TIMEOUT_MS, eigeneBeitraege } from '../lib/personen';
import { getBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/**
 * The whole request stays this far below the time limit of Static Web Apps (45 seconds): after a
 * slow Playwright API, the own Beiträge are found by the names rather than waiting any longer.
 */
export const MEINE_BEITRAEGE_BUDGET_MS = 40_000;

/**
 * The Beiträge with something left to do (open or paid too much) for the start page, and `ich`:
 * the IDs of the logged-in person's own, matched on the server (`docs/personen.md`); `null` when
 * nothing could be compared, then the page goes by the payer's name.
 */
export async function GetInternBeitraegeMeineEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const started = Date.now();
  try {
    const { loadedAt, batches, fees } = offeneBeitraege(readBeitraege(await getBeitraege()));
    const events = new Map(batches.map((batch) => [batch.id, batch.eventId]));
    const ich = await eigeneBeitraege(
      principal.userDetails,
      fees.map((fee) => ({
        id: fee.id,
        payer: fee.payer,
        payerId: fee.payerId,
        eventId: (fee.batchId && events.get(fee.batchId)) || null,
      })),
      Math.min(started + MEINE_BEITRAEGE_BUDGET_MS, Date.now() + EIGENE_BEITRAEGE_TIMEOUT_MS)
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
}

export default withErrorHandling(GetInternBeitraegeMeineEndpoint);
