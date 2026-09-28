import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { NIKOLAUS_CONFIG, findNikolausSlot, isBookingClosed } from '../lib/nikolaus-config';
import { isSlotInPast, rescheduleBooking } from '../lib/nikolaus-bookings';
import { sendBookingChangedMail } from '../lib/nikolaus-mails';
import {
  DEADLINE_PASSED,
  bookingResponse,
  canChangeBooking,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function RescheduleNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  const { booking, slot: currentSlot, token, body } = result;
  if (!currentSlot || !canChangeBooking(booking)) {
    return DEADLINE_PASSED;
  }

  if (!NIKOLAUS_CONFIG.active) {
    return errorResponse(
      403,
      'INACTIVE',
      'Umbuchungen sind derzeit nicht möglich. Bitte wenden Sie sich an kontakt@stamm-phoenix.de.'
    );
  }

  const target = typeof body.slot === 'string' ? findNikolausSlot(body.slot) : undefined;
  if (!target || isSlotInPast(target) || target.key === currentSlot.key) {
    return errorResponse(
      400,
      'INVALID_SLOT',
      'Bitte wählen Sie einen anderen gültigen Termin aus.'
    );
  }
  if (isBookingClosed(target.date)) {
    return errorResponse(
      409,
      'BOOKING_CLOSED',
      'Die Anmeldung für diesen Tag ist geschlossen. In dringenden Fällen schreiben Sie uns bitte an kontakt@stamm-phoenix.de.'
    );
  }

  const moved = await rescheduleBooking(booking, target);
  if (!moved.ok) {
    if (moved.reason === 'NOT_MOVED') {
      return errorResponse(
        503,
        'NOT_MOVED',
        'Ihr Termin konnte gerade nicht verlegt werden, Ihr bisheriger Termin bleibt bestehen. Bitte versuchen Sie es in ein paar Minuten erneut.'
      );
    }
    return moved.reason === 'SLOT_FULL'
      ? errorResponse(
          409,
          'SLOT_FULL',
          'Dieser Termin ist leider inzwischen ausgebucht. Ihr bisheriger Termin bleibt bestehen – bitte wählen Sie einen anderen.'
        )
      : errorResponse(
          409,
          'ALREADY_CHANGED',
          'Ihr Termin wurde in der Zwischenzeit bereits geändert. Bitte laden Sie die Seite neu.'
        );
  }

  try {
    await sendBookingChangedMail({ ...moved.booking, token, slot: target }, currentSlot);
  } catch (error: unknown) {
    context.warn('Sending Nikolaus booking rescheduled mail failed', error);
  }

  return bookingResponse(moved.booking);
}

export default withErrorHandling(RescheduleNikolausBookingEndpoint);
