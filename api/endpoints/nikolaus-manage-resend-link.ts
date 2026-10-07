import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getErrorStatus } from '../lib/response-utils';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { isValidNikolausEmail } from '../lib/nikolaus-validation';
import {
  LINK_RESEND_COOLDOWN_MINUTES,
  canResendLink,
  findActiveBookingByEmail,
  restorePreviousToken,
  rotateToken,
} from '../lib/nikolaus-bookings';
import { sendManageLinkMail } from '../lib/nikolaus-mails';
import {
  NO_STORE_HEADERS,
  getPublicStatus,
  readJsonBody,
  withNikolausWriteHandling,
} from '../lib/nikolaus-api';
import { errorResponse } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import { reserveNikolausMailQuota } from '../lib/nikolaus-mail-quota';

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

  // Admission is independent of whether the address has a booking.
  let mailPermit;
  try {
    mailPermit = await reserveNikolausMailQuota(context, Date.now(), 'resend');
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
        'Der Linkversand ist vorübergehend begrenzt. Bitte später erneut versuchen.'
      ),
      headers: NO_STORE_HEADERS,
    };

  const booking = await findActiveBookingByEmail(body.email);
  const config = await getNikolausSettings();
  const slot = booking ? findNikolausSlot(booking.slotKey, config) : undefined;
  if (!booking || !slot) {
    return sent;
  }

  if (!canResendLink(booking)) {
    context.warn(`Nikolaus link request for booking ${booking.id} skipped due to cooldown`);
    return sent;
  }

  let token: string | undefined;
  try {
    token = await rotateToken(booking);
  } catch (error: unknown) {
    // Another request reserved the cooldown or changed the booking. Reveal nothing.
    if (getErrorStatus(error) === 412 || getErrorStatus(error) === 404) return sent;
    throw error;
  }
  if (!token) return sent;
  try {
    await sendManageLinkMail(
      { ...booking, token, slot, config, siteUrl: getSiteUrl(request), mailPermit },
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

export default withNikolausWriteHandling(ResendNikolausLinkEndpoint);
