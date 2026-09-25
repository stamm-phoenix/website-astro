import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { getBooking, isSlotInPast, rescheduleBooking } from '../lib/nikolaus-bookings';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { getPublicStatus } from '../lib/nikolaus-api';
import { sendStaffRescheduleMail } from '../lib/nikolaus-mails';
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
 * POST: moves a booking to another free slot on behalf of the team and informs the family.
 *
 * Unlike families, staff may move bookings after the change deadline and while the booking
 * form is inactive. The capacity check and the kept token come from `rescheduleBooking`.
 */
export const NikolausRescheduleEndpoint = pflegeHandler(
  'nikolaus-verlegen',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const body = await readJsonBody(request);
    const rawMessage = typeof body?.message === 'string' ? body.message : '';
    const message = sanitizeRichTextWithLength(rawMessage);
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
        'Nur bestätigte oder ausstehende Buchungen können verlegt werden.'
      );
    }

    // The old slot may no longer be configured (e.g. a removed day); such bookings must be movable
    const previousSlot = findNikolausSlot(booking.slotKey);
    const target = typeof body?.toSlot === 'string' ? findNikolausSlot(body.toSlot) : undefined;
    if (!target || target.key === booking.slotKey || isSlotInPast(target)) {
      return errorResponse(400, 'INVALID_SLOT', 'Bitte einen anderen, freien Termin auswählen.');
    }

    const moved = await rescheduleBooking(booking, target);
    if (!moved.ok) {
      return moved.reason === 'SLOT_FULL'
        ? errorResponse(
            409,
            'SLOT_FULL',
            'Dieser Termin ist inzwischen belegt. Die Buchung bleibt auf ihrem bisherigen Termin.'
          )
        : CONFLICT;
    }
    if (!moved.oldItemRemoved) {
      context.error(
        `Nikolaus booking ${booking.id} was moved to item ${moved.booking.id}, but the old item could not be deleted`
      );
    }

    context.log(
      `[nikolaus] booking ${booking.id} moved from ${booking.slotKey} to ${target.key} (new item ${moved.booking.id}) by ${principal.userDetails}`
    );

    let mailSent = true;
    try {
      await sendStaffRescheduleMail({
        to: booking.email,
        familyName: booking.familyName,
        previousSlot: previousSlot ?? booking.slotKey,
        slot: target,
        messageHtml: message.textLength > 0 ? message.html : undefined,
        senderName: getPrincipalFirstName(principal),
      });
    } catch (error: unknown) {
      // The booking is moved anyway; the team has to inform the family themselves
      mailSent = false;
      context.warn('Sending Nikolaus reschedule mail failed', error);
    }

    return ok({ id: moved.booking.id, mailSent });
  }
);

export default withErrorHandling(NikolausRescheduleEndpoint);
