import { app, type HttpResponseInit } from '@azure/functions';
import { getSlotAvailability } from '../lib/nikolaus-bookings';
import { BOOKING_INACTIVE } from '../lib/nikolaus-api';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { NO_STORE_HEADERS } from '../lib/response-utils';
import { publicHandler } from '../lib/handler';

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

const defaultHandler = publicHandler(GetNikolausSlotsEndpoint);
export default defaultHandler;

app.http('nikolausSlots', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'nikolaus/slots',
  handler: defaultHandler,
});
