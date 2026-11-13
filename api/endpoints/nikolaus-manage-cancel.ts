import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { cancelBooking, getBooking, isBeforeChangeDeadline } from '../lib/nikolaus-bookings';
import {
  deadlinePassed,
  bookingResponse,
  withBookingConflictHandling,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';

async function handleCancelNikolausBooking(request: HttpRequest): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request, undefined, true);
  if (isErrorResponse(result)) return result;

  const { booking, config } = result;
  const status = getPublicStatus(booking);

  if (status !== 'pending' && status !== 'confirmed') {
    return bookingResponse(booking, config);
  }

  if (!isBeforeChangeDeadline(booking, config)) {
    return deadlinePassed(config);
  }

  await cancelBooking(booking);
  return bookingResponse(
    (await getBooking(booking.id)) ?? { ...booking, status: 'Storniert' },
    config
  );
}

export const CancelNikolausBookingEndpoint = withBookingConflictHandling(
  handleCancelNikolausBooking
);

export default CancelNikolausBookingEndpoint;

app.http('nikolausManageCancel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'nikolaus/manage/cancel',
  handler: CancelNikolausBookingEndpoint,
});
