import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getBooking, setBookingStatus } from '../lib/nikolaus-bookings';
import { sendBookingConfirmedMail } from '../lib/nikolaus-mails';
import {
  NO_STORE_HEADERS,
  getPublicStatus,
  isErrorResponse,
  loadAuthorizedBooking,
  readJsonBody,
  toPublicBookingInfo,
} from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function ConfirmNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const body = await readJsonBody(request);
  const result = await loadAuthorizedBooking(request, body?.token);
  if (isErrorResponse(result)) return result;

  const { booking, slot, token } = result;
  const status = getPublicStatus(booking);

  if (status === 'confirmed') {
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: toPublicBookingInfo(booking) };
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

  await setBookingStatus(booking.id, 'Bestaetigt', { BestaetigtAm: new Date().toISOString() });

  try {
    await sendBookingConfirmedMail({
      id: booking.id,
      token,
      familyName: booking.familyName,
      email: booking.email,
      withKrampus: booking.withKrampus,
      slot,
    });
  } catch (error: unknown) {
    // The booking is confirmed anyway, the second mail is only informational
    context.warn('Sending Nikolaus booking confirmed mail failed', error);
  }

  const updated = await getBooking(booking.id);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: toPublicBookingInfo(updated ?? booking),
  };
}

export default withErrorHandling(ConfirmNikolausBookingEndpoint);
