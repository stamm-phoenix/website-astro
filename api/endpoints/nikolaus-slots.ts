import type { HttpResponseInit } from '@azure/functions';
import { NIKOLAUS_CONFIG } from '../lib/nikolaus-config';
import { getSlotAvailability } from '../lib/nikolaus-bookings';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function GetNikolausSlotsEndpoint(): Promise<HttpResponseInit> {
  if (!NIKOLAUS_CONFIG.active) {
    return errorResponse(
      404,
      'INACTIVE',
      'Die Anmeldung zum Nikolausdienst ist derzeit geschlossen.'
    );
  }

  const slots = await getSlotAvailability();

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: slots,
  };
}

export default withErrorHandling(GetNikolausSlotsEndpoint);
