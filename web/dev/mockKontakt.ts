/** ALTCHA challenge and the contact form. */
import { randomBytes } from 'node:crypto';
import { validateKontaktMessage } from '../src/lib/kontaktConfig';
import { error, json, route } from './mockCore';
import type { MockResult } from './mockCore';

// ---------------------------------------------------------------------------------------------
// ALTCHA (Kontakt, Nikolaus booking, Sammelbestellung link request)

export const CAPTCHA_FAILED = (): MockResult =>
  error(403, 'CAPTCHA_FAILED', 'Die Prüfung, ob du ein Mensch bist, ist fehlgeschlagen.');

// Unsigned SHA-256 challenge: solved in a few milliseconds; the mock accepts any payload.
route(
  'GET',
  '/api/altcha/challenge',
  () =>
    json({
      parameters: {
        algorithm: 'SHA-256',
        nonce: randomBytes(16).toString('hex'),
        salt: randomBytes(16).toString('hex'),
        cost: 1,
        keyLength: 32,
        keyPrefix: '00',
      },
    }),
  true
);

// ---------------------------------------------------------------------------------------------
// Kontakt

route('POST', '/api/kontakt', (req) => {
  const { message, errors } = validateKontaktMessage(req.json ?? {});
  if (!message)
    return error(
      400,
      'VALIDATION_FAILED',
      'Bitte prüf deine Angaben.',
      errors as Record<string, string>
    );
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  return json({ status: 'sent', receipt: true });
});
