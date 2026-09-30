import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { isValidNikolausEmail } from '../lib/nikolaus-validation';
import {
  LINK_RESEND_COOLDOWN_MINUTES,
  canResendLink,
  findActiveBookingByEmail,
  restorePreviousToken,
  rotateToken,
} from '../lib/nikolaus-bookings';
import { sendManageLinkMail } from '../lib/nikolaus-mails';
import { NO_STORE_HEADERS, getPublicStatus, readJsonBody } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/**
 * Sends a new management link to the address of an active booking. The previous
 * link stops working. The answer is the same whether a booking exists or not.
 */
export async function ResendNikolausLinkEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const body = await readJsonBody(request);
  if (!body || !isValidNikolausEmail(body.email)) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'Bitte geben Sie eine gültige E-Mail-Adresse an.'
    );
  }

  const sent: HttpResponseInit = {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: { status: 'sent', cooldownMinutes: LINK_RESEND_COOLDOWN_MINUTES },
  };

  // Honeypot: bots fill in the hidden "website" field. Pretend success, send nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    context.warn('Nikolaus link request rejected by honeypot');
    return sent;
  }

  const booking = await findActiveBookingByEmail(body.email);
  const slot = booking ? findNikolausSlot(booking.slotKey) : undefined;
  if (!booking || !slot) {
    return sent;
  }

  if (!canResendLink(booking)) {
    context.warn(`Nikolaus link request for booking ${booking.id} skipped due to cooldown`);
    return sent;
  }

  const token = await rotateToken(booking);
  try {
    await sendManageLinkMail(
      { ...booking, token, slot },
      getPublicStatus(booking) === 'pending' ? booking.reservedUntil : undefined
    );
  } catch (error: unknown) {
    context.error('Sending Nikolaus management link failed', error);
    // Keep the previous link working and allow an immediate retry
    try {
      await restorePreviousToken(booking, token);
    } catch (restoreError: unknown) {
      context.error(`Restoring Nikolaus link for booking ${booking.id} failed`, restoreError);
    }
    return errorResponse(
      502,
      'MAIL_FAILED',
      'Die E-Mail konnte leider nicht versendet werden. Bitte versuchen Sie es später erneut.'
    );
  }

  return sent;
}

export default withErrorHandling(ResendNikolausLinkEndpoint);
