import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { cancelBooking, getBooking, isBeforeChangeDeadline } from '../lib/nikolaus-bookings';
import {
  DEADLINE_PASSED,
  bookingResponse,
  withBookingConflictHandling,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';

async function handleCancelNikolausBooking(request: HttpRequest): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request, undefined, true);
  if (isErrorResponse(result)) return result;

  const { booking } = result;
  const status = getPublicStatus(booking);

  if (status !== 'pending' && status !== 'confirmed') {
    return bookingResponse(booking);
  }

  if (!isBeforeChangeDeadline(booking)) {
    return DEADLINE_PASSED;
  }

  await cancelBooking(booking);
  return bookingResponse((await getBooking(booking.id)) ?? { ...booking, status: 'Storniert' });
}

export const CancelNikolausBookingEndpoint = withBookingConflictHandling(
  handleCancelNikolausBooking
);

export default CancelNikolausBookingEndpoint;
