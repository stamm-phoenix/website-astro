import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { setBookingStatus } from '../lib/nikolaus-bookings';
import { sendBookingConfirmedMail } from '../lib/nikolaus-mails';
import {
  bookingResponse,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function ConfirmNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  const { booking, slot, token } = result;
  const status = getPublicStatus(booking);

  if (status === 'confirmed') {
    return bookingResponse(booking);
  }

  if (status === 'cancelled') {
    return errorResponse(410, 'CANCELLED', 'Dieser Termin wurde bereits abgesagt.');
  }

  if (status === 'expired' || !slot) {
    if (booking.status === 'Ausstehend') {
      await setBookingStatus(booking.id, 'Abgelaufen');
    }
    return errorResponse(
      410,
      'EXPIRED',
      'Die Reservierung ist leider abgelaufen. Bitte melden Sie sich erneut für einen Termin an.'
    );
  }

  const confirmedAt = new Date();
  await setBookingStatus(booking.id, 'Bestaetigt', { BestaetigtAm: confirmedAt.toISOString() });

  try {
    await sendBookingConfirmedMail({ ...booking, token, slot });
  } catch (error: unknown) {
    // The booking is confirmed anyway, the second mail is only informational
    context.warn('Sending Nikolaus booking confirmed mail failed', error);
  }

  return bookingResponse({ ...booking, status: 'Bestaetigt', confirmedAt });
}

export default withErrorHandling(ConfirmNikolausBookingEndpoint);
