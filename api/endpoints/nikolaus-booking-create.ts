import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { findNikolausSlot, isBookingClosed } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { validateNikolausDetails } from '../lib/nikolaus-validation';
import { createBooking, deleteBooking, isSlotInPast } from '../lib/nikolaus-bookings';
import { sendConfirmationRequestMail } from '../lib/nikolaus-mails';
import {
  BOOKING_INACTIVE,
  NO_STORE_HEADERS,
  readJsonBody,
  withNikolausWriteHandling,
} from '../lib/nikolaus-api';
import { errorResponse } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import { reserveNikolausMailQuota } from '../lib/nikolaus-mail-quota';

export async function CreateNikolausBookingEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const config = await getNikolausSettings();
  if (!config.publicActive) return BOOKING_INACTIVE;

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

  const slot = typeof body.slot === 'string' ? findNikolausSlot(body.slot, config) : undefined;
  if (!slot || isSlotInPast(slot)) {
    return errorResponse(400, 'INVALID_SLOT', 'Bitte wählen Sie einen gültigen Termin aus.');
  }
  if (isBookingClosed(slot.date)) {
    return errorResponse(
      409,
      'BOOKING_CLOSED',
      'Die Anmeldung für diesen Tag ist geschlossen. In dringenden Fällen schreiben Sie uns bitte an kontakt@stamm-phoenix.de.'
    );
  }

  let mailPermit;
  try {
    mailPermit = await reserveNikolausMailQuota(context);
  } catch {
    context.error('Nikolaus mail admission unavailable');
    return {
      ...errorResponse(
        503,
        'MAIL_UNAVAILABLE',
        'Der Mailversand ist derzeit nicht verfügbar. Bitte später erneut versuchen.'
      ),
      headers: NO_STORE_HEADERS,
    };
  }
  if (!mailPermit)
    return {
      ...errorResponse(
        429,
        'MAIL_QUOTA',
        'Die Anmeldung ist vorübergehend begrenzt. Bitte später erneut versuchen.'
      ),
      headers: NO_STORE_HEADERS,
    };

  const result = await createBooking(details, slot, config);
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
      { ...details, token: result.token, slot, config, siteUrl: getSiteUrl(request), mailPermit },
      config.pendingHoldMinutes
    );
  } catch (error: unknown) {
    context.error('Sending Nikolaus confirmation mail failed', error);
    // Release the slot again, the booking could never be confirmed
    try {
      await deleteBooking(result.id, result.etag);
    } catch (cleanupError: unknown) {
      // The pending booking then expires on its own after the hold time
      context.error(`Releasing Nikolaus booking ${result.id} failed`, cleanupError);
    }
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

export default withNikolausWriteHandling(CreateNikolausBookingEndpoint);
