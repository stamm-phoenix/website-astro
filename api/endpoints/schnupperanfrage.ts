import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isAltchaConfigured, verifyAltchaPayload } from '../lib/altcha';
import { errorResponse, NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import {
  schnupperEingangMail,
  sendSchnupperFamilienMail,
  sendSchnupperStammMail,
} from '../lib/schnupper-mails';
import { validateSchnupperAnfrage } from '../lib/schnupper-model';
import { storeSchnupperAnfrage } from '../lib/schnupperanfragen';
import { getSiteUrl } from '../lib/site-url';
import { publicHandler } from '../lib/handler';

const MAIL = 'kontakt@stamm-phoenix.de';

function failure(status: number, code: string, message: string): HttpResponseInit {
  return { ...errorResponse(status, code, message), headers: NO_STORE_HEADERS };
}

/**
 * Stores a request for a Schnupperstunde (#139) and sends a note to the Stamm and a receipt to
 * the family. Requires a solved ALTCHA challenge. The request is saved first: a failed mail
 * never loses it. Returns 200 with a receipt flag, 400 for invalid input, 403 for rejected
 * proof, 429 for too many requests, 502 when saving failed and 503 without ALTCHA. A filled
 * honeypot returns 200 without saving anything.
 */
export async function SchnupperAnfrageSendEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (!isAltchaConfigured()) {
    return failure(
      503,
      'UNAVAILABLE',
      `Die Anfrage ist gerade nicht möglich. Deine Eingaben sind noch da. Schreib uns bitte direkt an ${MAIL}.`
    );
  }

  const body = await readJsonBody(request);
  if (!body) return failure(400, 'VALIDATION_FAILED', 'Bitte füll das Formular aus.');

  const sent = (receipt: boolean): HttpResponseInit => ({
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: { status: 'sent', receipt },
  });

  // Honeypot: bots fill in the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    context.warn('Schnupper request rejected by honeypot');
    return sent(true);
  }

  const { anfrage, errors } = validateSchnupperAnfrage(body);
  if (!anfrage) {
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
    return failure(
      403,
      'CAPTCHA_FAILED',
      'Die Prüfung, ob du ein Mensch bist, ist abgelaufen oder fehlgeschlagen. Bitte versuch es noch einmal.'
    );
  }

  let stored;
  try {
    stored = await storeSchnupperAnfrage(anfrage);
  } catch (error: unknown) {
    context.error('Storing a Schnupper request failed', error);
    return failure(
      502,
      'STORE_FAILED',
      `Deine Anfrage konnte leider nicht gespeichert werden. Deine Eingaben sind noch da. Bitte versuch es später noch einmal oder schreib uns direkt an ${MAIL}.`
    );
  }
  if (!stored) {
    context.warn('Schnupper request rejected by quota');
    return failure(
      429,
      'QUOTA',
      `Gerade erreichen uns sehr viele Anfragen. Deine Eingaben sind noch da. Bitte versuch es später noch einmal oder schreib uns direkt an ${MAIL}.`
    );
  }

  // The request is saved; a failed mail must not make the family send it again.
  try {
    await sendSchnupperStammMail(stored, getSiteUrl(request));
  } catch (error: unknown) {
    context.error('Sending the Schnupper note to the Stamm failed', error);
  }
  try {
    await sendSchnupperFamilienMail(stored, schnupperEingangMail(stored));
  } catch (error: unknown) {
    context.error('Sending the Schnupper receipt failed', error);
    return sent(false);
  }
  return sent(true);
}

export const SchnupperAnfrageSend = publicHandler(SchnupperAnfrageSendEndpoint);
