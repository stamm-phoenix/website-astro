import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { NIKOLAUS_CONFIG, findNikolausSlot } from '../lib/nikolaus-config';
import { validateNikolausDetails } from '../lib/nikolaus-validation';
import { createBooking, deleteBooking, isSlotInPast } from '../lib/nikolaus-bookings';
import { sendConfirmationRequestMail } from '../lib/nikolaus-mails';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

export async function CreateNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (!NIKOLAUS_CONFIG.active) {
    return errorResponse(
      404,
      'INACTIVE',
      'Die Anmeldung zum Nikolausdienst ist derzeit geschlossen.'
    );
  }

  const body = await readJsonBody(request);
  if (!body) {
    return errorResponse(400, 'INVALID_REQUEST', 'Die Anfrage konnte nicht gelesen werden.');
  }

  // Honeypot: bots fill in the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    context.warn('Nikolaus booking rejected by honeypot');
    return { status: 201, headers: NO_STORE_HEADERS, jsonBody: { status: 'pending' } };
  }

  const { details, errors } = validateNikolausDetails(body);
  if (!details) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      Object.values(errors)[0] ?? 'Ungültige Angaben.'
    );
  }

  const slot = typeof body.slot === 'string' ? findNikolausSlot(body.slot) : undefined;
  if (!slot || isSlotInPast(slot)) {
    return errorResponse(400, 'INVALID_SLOT', 'Bitte wählen Sie einen gültigen Termin aus.');
  }

  const result = await createBooking(details, slot);
  if (!result.ok && result.reason === 'EMAIL_EXISTS') {
    return errorResponse(
      409,
      'EMAIL_EXISTS',
      'Für diese E-Mail-Adresse gibt es bereits einen Termin. Sie können sich einen neuen Link zur Terminverwaltung schicken lassen.'
    );
  }
  if (!result.ok) {
    return errorResponse(
      409,
      'SLOT_FULL',
      'Dieser Termin ist leider inzwischen ausgebucht. Bitte wählen Sie einen anderen Termin.'
    );
  }

  try {
    await sendConfirmationRequestMail(
      { ...details, token: result.token, slot },
      NIKOLAUS_CONFIG.pendingHoldMinutes
    );
  } catch (error: unknown) {
    context.error('Sending Nikolaus confirmation mail failed', error);
    // Release the slot again, the booking could never be confirmed
    await deleteBooking(result.id);
    return errorResponse(
      502,
      'MAIL_FAILED',
      'Die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte prüfen Sie Ihre E-Mail-Adresse oder versuchen Sie es später erneut.'
    );
  }

  return {
    status: 201,
    headers: NO_STORE_HEADERS,
    jsonBody: { status: 'pending', reservedUntil: result.reservedUntil.toISOString() },
  };
}

export default withErrorHandling(CreateNikolausBookingEndpoint);
