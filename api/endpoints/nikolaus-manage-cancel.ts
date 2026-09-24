import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { isBeforeChangeDeadline, setBookingStatus } from '../lib/nikolaus-bookings';
import {
  DEADLINE_PASSED,
  bookingResponse,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';
import { withErrorHandling } from '../lib/response-utils';

export async function CancelNikolausBookingEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  const { booking } = result;
  const status = getPublicStatus(booking);

  if (status !== 'pending' && status !== 'confirmed') {
    return bookingResponse(booking);
  }

  if (!isBeforeChangeDeadline(booking)) {
    return DEADLINE_PASSED;
  }

  await setBookingStatus(booking.id, 'Storniert');
  return bookingResponse({ ...booking, status: 'Storniert' });
}

export default withErrorHandling(CancelNikolausBookingEndpoint);
