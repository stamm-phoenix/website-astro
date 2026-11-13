import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { z } from 'zod';
import type { ClientPrincipal } from '../lib/staff-auth';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { getBooking } from '../lib/nikolaus-bookings';
import { findNikolausSlot } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { sendStaffMessageMail } from '../lib/nikolaus-mails';
import { sanitizeRichTextWithLength } from '../lib/validation/rich-text';
import { lenientObject, parseWith } from '../lib/validation/zod';
import { NOT_FOUND, NO_CONTENT } from '../lib/pflege-api';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';
import { nikolausGate } from '../lib/nikolaus-staff';

const MAX_MESSAGE_LENGTH = 5000;

interface MessageInput {
  subject: string;
  messageHtml: string;
}

/** The subject: trimmed, runs of whitespace collapsed; anything but text counts as missing. */
const subjectSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
  z
    .string()
    .min(1, { error: 'Bitte einen Betreff angeben.' })
    .max(150, {
      error: `Der Betreff darf höchstens ${150} Zeichen lang sein.`,
    })
);

/** The message as sanitized HTML; its visible text must not be empty nor too long. */
const messageSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value : ''),
  z.string().transform((html, ctx): string => {
    const { html: clean, textLength } = sanitizeRichTextWithLength(html);
    if (textLength === 0) {
      ctx.addIssue({ code: 'custom', message: 'Bitte eine Nachricht schreiben.' });
    } else if (textLength > MAX_MESSAGE_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        message: `Die Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.`,
      });
    }
    return clean;
  })
);

const messageInputSchema = lenientObject({ subject: subjectSchema, message: messageSchema });

function validateMessage(body: Record<string, unknown> | null): MessageInput {
  const { subject, message } = parseWith(messageInputSchema, body);
  return { subject, messageHtml: message };
}

/** POST: sends a message from the Nikolaus team to the family of a booking. */
export const NikolausMessageEndpoint = staffHandler(
  'nikolaus-nachricht',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const input = validateMessage(await readJsonBody(request));
    const booking = await getBooking(id);
    if (!booking) return NOT_FOUND;
    const config = await getNikolausSettings();

    try {
      await sendStaffMessageMail({
        to: booking.email,
        familyName: booking.familyName,
        slot: findNikolausSlot(booking.slotKey, config) ?? booking.slotKey,
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

    // Booking only: subject and message may contain family details and stay in the mailbox's
    // sent items; the acting user is logged by staffHandler
    context.log(`[nikolaus] message sent to booking ${id}`);
    return NO_CONTENT;
  },
  { gate: nikolausGate }
);

export default NikolausMessageEndpoint;

app.http('internNikolausMessage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/nikolaus/bookings/{id}/message',
  handler: NikolausMessageEndpoint,
});
