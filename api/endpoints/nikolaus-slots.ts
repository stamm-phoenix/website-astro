import type { HttpResponseInit } from '@azure/functions';
import { getSlotAvailability } from '../lib/nikolaus-bookings';
import { BOOKING_INACTIVE, NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { withErrorHandling } from '../lib/response-utils';

export async function GetNikolausSlotsEndpoint(): Promise<HttpResponseInit> {
  const config = await getNikolausSettings();
  if (!config.publicActive) return BOOKING_INACTIVE;

  const slots = await getSlotAvailability(config);

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: slots,
  };
}

export default withErrorHandling(GetNikolausSlotsEndpoint);
