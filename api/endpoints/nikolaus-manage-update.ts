import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateNikolausDetails } from '../lib/nikolaus-validation';
import {
  BookingEmailExistsError,
  findActiveBookingByEmail,
  updateBookingDetails,
} from '../lib/nikolaus-bookings';
import { sendBookingChangedMail, sendEmailChangedNotice } from '../lib/nikolaus-mails';
import {
  deadlinePassed,
  bookingResponse,
  withBookingConflictHandling,
  canChangeBooking,
  isErrorResponse,
  loadAuthorizedBooking,
} from '../lib/nikolaus-api';
import { errorResponse } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';

async function handleUpdateNikolausBooking(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request, undefined, true);
  if (isErrorResponse(result)) return result;

  const { booking, slot, config, token, body } = result;
  if (!slot || !canChangeBooking(booking, config)) {
    return deadlinePassed(config);
  }

  const { details, errors } = validateNikolausDetails(body);
  if (!details) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      Object.values(errors)[0] ?? 'Ungültige Angaben.'
    );
  }

  const emailExists = errorResponse(
    409,
    'EMAIL_EXISTS',
    'Für diese E-Mail-Adresse gibt es bereits einen anderen Termin. Bitte verwenden Sie eine andere Adresse.'
  );
  const emailChanged = details.email.toLowerCase() !== booking.email.toLowerCase();
  if (emailChanged && (await findActiveBookingByEmail(details.email, booking.tokenHash))) {
    return emailExists;
  }

  let updated;
  try {
    updated = await updateBookingDetails(booking, details);
  } catch (error: unknown) {
    // Another booking took the address between the check above and the update
    if (error instanceof BookingEmailExistsError) return emailExists;
    throw error;
  }

  try {
    await sendBookingChangedMail({ ...updated, token, slot, config, siteUrl: getSiteUrl(request) });
  } catch (error: unknown) {
    // The change is saved anyway, the mails are only informational
    context.warn('Sending Nikolaus booking changed mail failed', error);
  }

  // Sent separately, as it is the only alert to the previous address
  if (emailChanged && booking.email) {
    try {
      await sendEmailChangedNotice(booking.email, details.email, details.familyName);
    } catch (error: unknown) {
      context.warn('Sending Nikolaus email changed notice failed', error);
    }
  }

  return bookingResponse(updated, config);
}

export const UpdateNikolausBookingEndpoint = withBookingConflictHandling(
  handleUpdateNikolausBooking
);

export default UpdateNikolausBookingEndpoint;
