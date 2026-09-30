import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { confirmBooking, setBookingStatus } from '../lib/nikolaus-bookings';
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

  if (!slot) {
    // The slot is not (or no longer) part of the configuration. This is not an expired
    // reservation, so the booking is left untouched for the team to sort out.
    return errorResponse(
      409,
      'SLOT_UNAVAILABLE',
      'Dieser Termin wird derzeit nicht angeboten und kann deshalb nicht bestätigt werden. Bitte wenden Sie sich an kontakt@stamm-phoenix.de.'
    );
  }

  if (status === 'expired') {
    if (booking.status === 'Ausstehend') {
      await setBookingStatus(booking.id, 'Abgelaufen');
    }
    return errorResponse(
      410,
      'EXPIRED',
      'Die Reservierung ist leider abgelaufen. Bitte melden Sie sich erneut für einen Termin an.'
    );
  }

  const confirmed = await confirmBooking(booking);

  try {
    await sendBookingConfirmedMail({ ...confirmed, token, slot });
  } catch (error: unknown) {
    // The booking is confirmed anyway, the second mail is only informational
    context.warn('Sending Nikolaus booking confirmed mail failed', error);
  }

  return bookingResponse(confirmed);
}

export default withErrorHandling(ConfirmNikolausBookingEndpoint);
