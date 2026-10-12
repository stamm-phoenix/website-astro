import type { HttpResponseInit } from '@azure/functions';
import { createAltchaChallenge, isAltchaConfigured } from '../lib/altcha';
import { NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/**
 * Returns a new ALTCHA challenge for the public forms with HTTP 200, or 503 when its secret
 * is not configured.
 * @throws Propagates challenge creation errors; the registered wrapper converts them to 500.
 */
export async function AltchaChallengeEndpoint(): Promise<HttpResponseInit> {
  if (!isAltchaConfigured())
    return {
      ...errorResponse(
        503,
        'UNAVAILABLE',
        'Die Prüfung, ob du ein Mensch bist, ist gerade nicht verfügbar. Bitte versuch es später noch einmal oder schreib uns an kontakt@stamm-phoenix.de.'
      ),
      headers: NO_STORE_HEADERS,
    };
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: await createAltchaChallenge() };
}

export const AltchaChallenge = withErrorHandling(AltchaChallengeEndpoint);
