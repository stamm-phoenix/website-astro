import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { NIKOLAUS_CONFIG, findNikolausSlot } from '../lib/nikolaus-config';
import type { NewNikolausBooking } from '../lib/nikolaus-bookings';
import { createBooking, deleteBooking, isSlotInPast } from '../lib/nikolaus-bookings';
import { sendConfirmationRequestMail } from '../lib/nikolaus-mails';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()/-]{5,30}$/;

function readText(body: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = body[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

type ValidationResult = { ok: true; value: NewNikolausBooking } | { ok: false; message: string };

function validate(body: Record<string, unknown>): ValidationResult {
  const familyName = readText(body, 'familyName', 100);
  if (!familyName) return { ok: false, message: 'Bitte geben Sie Ihren Familiennamen an.' };

  const email = readText(body, 'email', 254);
  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' };
  }

  const phone = readText(body, 'phone', 30);
  if (!phone || !PHONE_PATTERN.test(phone)) {
    return { ok: false, message: 'Bitte geben Sie eine gültige Telefonnummer an.' };
  }

  const slotKey = readText(body, 'slot', 20);
  if (!slotKey) return { ok: false, message: 'Bitte wählen Sie einen Termin aus.' };

  if (typeof body.withKrampus !== 'boolean') {
    return { ok: false, message: 'Bitte geben Sie an, ob der Krampus mit reinkommen darf.' };
  }

  return {
    ok: true,
    value: { familyName, email, phone, slotKey, withKrampus: body.withKrampus },
  };
}

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

  const validation = validate(body);
  if (!validation.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', validation.message);
  }
  const input = validation.value;

  const slot = findNikolausSlot(input.slotKey);
  if (!slot || isSlotInPast(slot)) {
    return errorResponse(400, 'INVALID_SLOT', 'Dieser Termin kann nicht gebucht werden.');
  }

  const result = await createBooking(input, slot);
  if (!result.ok) {
    return errorResponse(
      409,
      'SLOT_FULL',
      'Dieser Termin ist leider inzwischen ausgebucht. Bitte wählen Sie einen anderen Termin.'
    );
  }

  try {
    await sendConfirmationRequestMail(
      {
        id: result.id,
        token: result.token,
        familyName: input.familyName,
        email: input.email,
        withKrampus: input.withKrampus,
        slot,
      },
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
