import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { cancelBooking, getBooking } from '../lib/nikolaus-bookings';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { getPublicStatus } from '../lib/nikolaus-api';
import { sendStaffCancellationMail } from '../lib/nikolaus-mails';
import { ValidationError, sanitizeRichTextWithLength } from '../lib/pflege-validation';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const MAX_MESSAGE_LENGTH = 5000;

/**
 * POST: cancels a booking on behalf of the team and informs the family. Unlike families,
 * staff may cancel after the change deadline.
 */
export const NikolausCancelEndpoint = pflegeHandler(
  'nikolaus-absagen',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const body = await readJsonBody(request);
    const message = sanitizeRichTextWithLength(
      typeof body?.message === 'string' ? body.message : ''
    );
    if (message.textLength > MAX_MESSAGE_LENGTH) {
      throw new ValidationError({
        message: `Die Erklärung darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.`,
      });
    }

    const booking = await getBooking(id);
    if (!booking) return NOT_FOUND;
    // The view was loaded before someone else moved or changed this booking
    if (booking.slotKey !== body?.fromSlot) return CONFLICT;

    const status = getPublicStatus(booking);
    if (status !== 'pending' && status !== 'confirmed') {
      return errorResponse(
        400,
        'NOT_ACTIVE',
        'Nur bestätigte oder ausstehende Buchungen können abgesagt werden.'
      );
    }

    await cancelBooking(booking);
    context.log(
      `[nikolaus] booking ${booking.id} (${booking.slotKey}) cancelled by ${principal.userDetails}`
    );

    let mailSent = true;
    try {
      await sendStaffCancellationMail({
        to: booking.email,
        familyName: booking.familyName,
        slot: findNikolausSlot(booking.slotKey),
        messageHtml: message.textLength > 0 ? message.html : undefined,
        senderName: getPrincipalFirstName(principal),
      });
    } catch (error: unknown) {
      // The booking is cancelled anyway; the team has to inform the family themselves
      mailSent = false;
      context.warn('Sending Nikolaus cancellation mail failed', error);
    }

    return ok({ mailSent });
  }
);

export default withErrorHandling(NikolausCancelEndpoint);
