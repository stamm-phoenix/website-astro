import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { getBooking } from '../lib/nikolaus-bookings';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { sendStaffMessageMail } from '../lib/nikolaus-mails';
import { ValidationError, sanitizeRichTextWithLength } from '../lib/pflege-validation';
import {
  NOT_FOUND,
  NO_CONTENT,
  METHOD_NOT_ALLOWED,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const MAX_SUBJECT_LENGTH = 150;
const MAX_MESSAGE_LENGTH = 5000;

interface MessageInput {
  subject: string;
  messageHtml: string;
}

function validateMessage(body: Record<string, unknown> | null): MessageInput {
  const errors: Record<string, string> = {};
  const subject = typeof body?.subject === 'string' ? body.subject.trim().replace(/\s+/g, ' ') : '';
  if (!subject) errors.subject = 'Bitte einen Betreff angeben.';
  else if (subject.length > MAX_SUBJECT_LENGTH) {
    errors.subject = `Der Betreff darf höchstens ${MAX_SUBJECT_LENGTH} Zeichen lang sein.`;
  }

  const message = sanitizeRichTextWithLength(typeof body?.message === 'string' ? body.message : '');
  if (message.textLength === 0) errors.message = 'Bitte eine Nachricht schreiben.';
  else if (message.textLength > MAX_MESSAGE_LENGTH) {
    errors.message = `Die Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.`;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { subject, messageHtml: message.html };
}

/** POST: sends a message from the Nikolaus team to the family of a booking. */
export const NikolausMessageEndpoint = pflegeHandler(
  'nikolaus-nachricht',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const input = validateMessage(await readJsonBody(request));
    const booking = await getBooking(id);
    if (!booking) return NOT_FOUND;

    try {
      await sendStaffMessageMail({
        to: booking.email,
        familyName: booking.familyName,
        slot: findNikolausSlot(booking.slotKey),
        subject: input.subject,
        messageHtml: input.messageHtml,
        senderName: getPrincipalFirstName(principal),
      });
    } catch (error: unknown) {
      context.error('Sending Nikolaus staff message failed', error);
      return errorResponse(
        502,
        'MAIL_FAILED',
        'Die Nachricht konnte nicht verschickt werden. Bitte versuche es später erneut.'
      );
    }

    // Subject only: the message itself stays in the mailbox's sent items, not in the logs
    context.log(
      `[nikolaus] message to booking ${id} by ${principal.userDetails}: "${input.subject}"`
    );
    return NO_CONTENT;
  }
);

export default withErrorHandling(NikolausMessageEndpoint);
