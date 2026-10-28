import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isAltchaConfigured, verifyAltchaPayload } from '../lib/altcha';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { validateProblemReport } from '../lib/problemmeldung-model';
import { runProblemAssessment } from '../lib/problemmeldung-ki';
import {
  createProblemMeldung,
  isProblemQuotaReached,
  purgeExpiredProblemMeldungen,
} from '../lib/problemmeldungen';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

const MAIL = 'kontakt@stamm-phoenix.de';

const UNAVAILABLE: HttpResponseInit = {
  ...errorResponse(
    503,
    'UNAVAILABLE',
    `Das Melden ist gerade nicht möglich. Deine Eingaben sind noch da. Schreib uns bitte direkt an ${MAIL}.`
  ),
  headers: NO_STORE_HEADERS,
};

/**
 * Stores a report of „Problem melden“ and has the language model assess it. Requires a solved
 * ALTCHA challenge. The report is saved first: a failure of the assessment never loses it.
 * Returns 200 with the report number, 400 for invalid input, 403 for rejected proof, 429 for
 * too many reports and 503 when ALTCHA is not configured. A filled honeypot returns 200
 * without saving anything.
 */
export async function ProblemMeldungSendEndpoint(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (!isAltchaConfigured()) return UNAVAILABLE;

  const body = await readJsonBody(request);
  if (!body) {
    return {
      ...errorResponse(400, 'VALIDATION_FAILED', 'Bitte beschreib das Problem.'),
      headers: NO_STORE_HEADERS,
    };
  }

  // Honeypot: bots fill in the hidden "website" field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    context.warn('Problem report rejected by honeypot');
    return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { status: 'sent', id: 'PM-0' } };
  }

  const { report, errors } = validateProblemReport(body);
  if (!report) {
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

  if (await isProblemQuotaReached()) {
    context.warn('Problem report rejected by quota');
    return {
      ...errorResponse(
        429,
        'QUOTA',
        `Gerade erreichen uns sehr viele Meldungen. Bitte versuch es später noch einmal oder schreib uns direkt an ${MAIL}.`
      ),
      headers: NO_STORE_HEADERS,
    };
  }

  let id: number;
  try {
    id = await createProblemMeldung(report);
  } catch (error: unknown) {
    context.error('Storing a problem report failed', error);
    return {
      ...errorResponse(
        502,
        'STORE_FAILED',
        `Deine Meldung konnte leider nicht gespeichert werden. Deine Eingaben sind noch da. Bitte versuch es später noch einmal oder schreib uns direkt an ${MAIL}.`
      ),
      headers: NO_STORE_HEADERS,
    };
  }

  // The report is saved; whatever happens next must not make the visitor send it again
  try {
    await runProblemAssessment(String(id));
  } catch (error: unknown) {
    context.error('Assessing a problem report failed', error);
  }
  try {
    await purgeExpiredProblemMeldungen();
  } catch (error: unknown) {
    context.error('Deleting expired problem reports failed', error);
  }

  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: { status: 'sent', id: `PM-${id}` } };
}

export const ProblemMeldungSend = withErrorHandling(ProblemMeldungSendEndpoint);
