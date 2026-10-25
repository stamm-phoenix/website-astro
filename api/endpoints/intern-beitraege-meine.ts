import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { offeneBeitraege, readBeitraege } from '../lib/beitraege';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { eigeneBeitraege } from '../lib/personen';
import { getBeitraege, PlaywrightApiError } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

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
      }))
    );
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { loadedAt, batches, fees, ich } };
  } catch (error: unknown) {
    if (!(error instanceof PlaywrightApiError)) throw error;
    return errorResponse(
      502,
      'BEITRAEGE_UNAVAILABLE',
      'Deine Beiträge konnten nicht aus CampFlow geladen werden. Versuche es später noch einmal.'
    );
  }
}

export default withErrorHandling(GetInternBeitraegeMeineEndpoint);
