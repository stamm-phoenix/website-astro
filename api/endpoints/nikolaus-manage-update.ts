import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateNikolausDetails } from '../lib/nikolaus-validation';
import { updateBookingDetails } from '../lib/nikolaus-bookings';
import { sendBookingChangedMail, sendEmailChangedNotice } from '../lib/nikolaus-mails';
import {
  DEADLINE_PASSED,
  bookingResponse,
  canChangeBooking,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function UpdateNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request);
  if (isErrorResponse(result)) return result;

  const { booking, slot, token, body } = result;
  if (!slot || !canChangeBooking(booking)) {
    return DEADLINE_PASSED;
  }

  const { details, errors } = validateNikolausDetails(body);
  if (!details) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      Object.values(errors)[0] ?? 'Ungültige Angaben.'
    );
  }

  const updated = await updateBookingDetails(booking, details);
  const emailChanged = details.email.toLowerCase() !== booking.email.toLowerCase();

  try {
    await sendBookingChangedMail({ ...updated, token, slot });
    if (emailChanged && booking.email) {
      await sendEmailChangedNotice(booking.email, details.email, details.familyName);
    }
  } catch (error: unknown) {
    // The change is saved anyway, the mails are only informational
    context.warn('Sending Nikolaus booking changed mail failed', error);
  }

  return bookingResponse(updated);
}

export default withErrorHandling(UpdateNikolausBookingEndpoint);
