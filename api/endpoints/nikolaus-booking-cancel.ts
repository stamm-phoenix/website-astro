import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getBooking, setBookingStatus } from '../lib/nikolaus-bookings';
import {
  NO_STORE_HEADERS,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
  readJsonBody,
  toPublicBookingInfo,
} from '../lib/nikolaus-api';
import { withErrorHandling } from '../lib/response-utils';

export async function CancelNikolausBookingEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const body = await readJsonBody(request);
  const result = await loadAuthorizedBooking(request, body?.token);
  if (isErrorResponse(result)) return result;

  const { booking } = result;
  const status = getPublicStatus(booking);

  if (status === 'pending' || status === 'confirmed') {
    await setBookingStatus(booking.id, 'Storniert');
  }

  const updated = await getBooking(booking.id);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: toPublicBookingInfo(updated ?? booking),
  };
}

export default withErrorHandling(CancelNikolausBookingEndpoint);
