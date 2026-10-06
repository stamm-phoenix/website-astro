import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { createAltchaChallenge, isAltchaConfigured, verifyAltchaPayload } from '../lib/altcha';
import { reserveKontaktQuota, sendKontaktMessage, sendKontaktReceipt } from '../lib/kontakt';
import { validateKontaktMessage } from '../lib/kontakt-validation';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const UNAVAILABLE: HttpResponseInit = {
  ...errorResponse(
    503,
    'UNAVAILABLE',
    'Das Kontaktformular ist gerade nicht verfügbar. Schreib uns bitte direkt an kontakt@stamm-phoenix.de.'
  ),
  headers: NO_STORE_HEADERS,
};

/**
 * Returns a new ALTCHA challenge with HTTP 200, or 503 when its secret is not configured.
 * @throws Propagates challenge creation errors; the registered wrapper converts them to 500.
 */
export async function KontaktChallengeEndpoint(): Promise<HttpResponseInit> {
  if (!isAltchaConfigured()) return UNAVAILABLE;
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await createAltchaChallenge() };
}

/**
 * Sends a message from the contact form to the Stamm and a receipt to the given address.
 * Requires a solved ALTCHA challenge.
 * Returns 200 with a receipt flag; receipt failure alone sets that flag to false.
 * A filled honeypot returns 200 with receipt true without sending either mail.
 * Returns 400 for invalid input, 403 for rejected proof, 429 for exhausted quota,
 * 502 for message delivery failure, or 503 when ALTCHA is not configured.
 * Accepted proof is consumed before quota admission, and mail failure does not refund quota.
 * @throws Propagates ALTCHA setup errors; the registered wrapper converts them to 500.
 */
export async function KontaktSendEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (!isAltchaConfigured()) return UNAVAILABLE;

  const body = await readJsonBody(request);
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Bitte füll alle Felder aus.');
  }

  const sent = (receipt: boolean): HttpResponseInit => ({
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: { status: 'sent', receipt },
  });

  // Honeypot: bots fill in the hidden "website" field. Pretend success, send nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    context.warn('Contact message rejected by honeypot');
    return sent(true);
  }

  const { message, errors } = validateKontaktMessage(body);
  if (!message) {
    return {
      status: 400,
      headers: NO_STORE_HEADERS,
      jsonBody: {
        error: 'VALIDATION_FAILED',
        code: 'VALIDATION_FAILED',
        message: 'Bitte prüf deine Angaben.',
        fields: errors,
      },
    };
  }

  if (!(await verifyAltchaPayload(body.altcha))) {
    return {
      ...errorResponse(
        403,
        'CAPTCHA_FAILED',
        'Die Prüfung, ob du ein Mensch bist, ist abgelaufen oder fehlgeschlagen. Bitte versuch es noch einmal.'
      ),
      headers: NO_STORE_HEADERS,
    };
  }

  if (!reserveKontaktQuota()) {
    context.warn('Contact message rejected by quota');
    return {
      ...errorResponse(
        429,
        'QUOTA',
        'Gerade erreichen uns sehr viele Nachrichten. Bitte versuch es später noch einmal oder schreib uns direkt an kontakt@stamm-phoenix.de.'
      ),
      headers: NO_STORE_HEADERS,
    };
  }

  try {
    await sendKontaktMessage(message);
  } catch (error: unknown) {
    context.error('Sending contact message failed', error);
    return {
      ...errorResponse(
        502,
        'MAIL_FAILED',
        'Deine Nachricht konnte leider nicht versendet werden. Bitte versuch es später noch einmal oder schreib uns direkt an kontakt@stamm-phoenix.de.'
      ),
      headers: NO_STORE_HEADERS,
    };
  }

  // The message has arrived; a failed receipt must not make the visitor send it again.
  try {
    await sendKontaktReceipt(message);
  } catch (error: unknown) {
    context.error('Sending contact receipt failed', error);
    return sent(false);
  }

  return sent(true);
}

export const KontaktChallenge = withErrorHandling(KontaktChallengeEndpoint);
export const KontaktSend = withErrorHandling(KontaktSendEndpoint);
