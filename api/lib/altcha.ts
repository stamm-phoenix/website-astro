import { createHmac } from 'node:crypto';
import type * as AltchaLib from 'altcha-lib' with { 'resolution-mode': 'import' };
import type { Challenge, DeriveKeyFunction, Solution } from 'altcha-lib' with {
  'resolution-mode': 'import',
};
import { CONFIG } from './config';
import { EnvironmentVariable, getEnvironment } from './environment';

/**
 * Self-hosted ALTCHA proof of work: the browser computes a PBKDF2 key before it may submit
 * a form. No third party is involved, so the widget needs no consent.
 *
 * `altcha-lib` only ships ESM types, so it is loaded with `import()` from this CommonJS module.
 */

export type AltchaChallenge = Challenge;

/** Nonces of payloads already used on this instance, with the expiry of their challenge. */
const usedChallenges = new Map<string, number>();
const MAX_USED_CHALLENGES = 10_000;

interface AltchaFunctions {
  createChallenge: typeof AltchaLib.createChallenge;
  randomInt: typeof AltchaLib.randomInt;
  verifySolution: typeof AltchaLib.verifySolution;
  deriveKey: DeriveKeyFunction;
}

/** Loads the ALTCHA operations and PBKDF2 implementation; import errors propagate. */
async function altcha(): Promise<AltchaFunctions> {
  const [{ createChallenge, randomInt, verifySolution }, { deriveKey }] = await Promise.all([
    import('altcha-lib'),
    import('altcha-lib/algorithms/pbkdf2'),
  ]);
  return { createChallenge, randomInt, verifySolution, deriveKey };
}

/**
 * Reads the challenge signing secret and derives the key signing secret from it.
 * @throws If KONTAKT_ALTCHA_SECRET is missing or empty.
 */
function secrets(): { signature: string; keySignature: string } {
  const signature = getEnvironment(EnvironmentVariable.KONTAKT_ALTCHA_SECRET);
  // A second secret for the derived key, without another App Setting.
  const keySignature = createHmac('sha256', signature).update('altcha-key-signature').digest('hex');
  return { signature, keySignature };
}

/** Whether the secret is configured; without it, no challenge can be created or verified. */
export function isAltchaConfigured(): boolean {
  return Boolean(process.env[EnvironmentVariable.KONTAKT_ALTCHA_SECRET]);
}

/**
 * Creates a signed PBKDF2 challenge using the configured cost, counter range, and lifetime.
 * @param now Unix time in milliseconds from which the challenge lifetime is measured.
 * @throws Propagates module loading, missing-secret, and challenge creation errors.
 */
export async function createAltchaChallenge(now = Date.now()): Promise<AltchaChallenge> {
  const { createChallenge, randomInt, deriveKey } = await altcha();
  const { signature, keySignature } = secrets();
  const { cost, minCounter, maxCounter, expiresMinutes } = CONFIG.kontakt.altcha;
  return createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost,
    counter: randomInt(maxCounter, minCounter),
    deriveKey,
    expiresAt: new Date(now + expiresMinutes * 60_000),
    hmacSignatureSecret: signature,
    hmacKeySignatureSecret: keySignature,
  });
}

/**
 * Decodes the widget's base64 JSON with basic shape checks, without verifying its proof.
 * Returns null for nonstrings, strings over 10,000 UTF-16 code units, decoding/JSON errors,
 * or missing challenge/solution objects, parameters, or a string nonce.
 */
function parsePayload(value: unknown): { challenge: Challenge; solution: Solution } | null {
  if (typeof value !== 'string' || value.length > 10_000) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    const { challenge, solution } = payload as Record<string, unknown>;
    if (!challenge || typeof challenge !== 'object' || !solution || typeof solution !== 'object')
      return null;
    const parameters = (challenge as Record<string, unknown>).parameters;
    if (!parameters || typeof parameters !== 'object') return null;
    if (typeof (parameters as Record<string, unknown>).nonce !== 'string') return null;
    return { challenge: challenge as Challenge, solution: solution as Solution };
  } catch {
    return null;
  }
}

/**
 * Drops expired nonces, then records this nonce unless it is still tracked (returns false).
 * At capacity, evicts the oldest entry even if unexpired. Times are Unix milliseconds.
 */
function markUsed(nonce: string, expiresAt: number, now: number): boolean {
  for (const [key, expiry] of usedChallenges) if (expiry <= now) usedChallenges.delete(key);
  if (usedChallenges.has(nonce)) return false;
  // Map keeps insertion order, so the first entry is the oldest.
  if (usedChallenges.size >= MAX_USED_CHALLENGES)
    usedChallenges.delete(usedChallenges.keys().next().value as string);
  usedChallenges.set(nonce, expiresAt);
  return true;
}

/**
 * Verifies the widget's base64 payload and records an accepted nonce on this instance.
 * Returns false for malformed payloads, failed verification (including thrown verification
 * errors), or a nonce still in the replay cache. Capacity eviction can remove unexpired nonces.
 * @param now Unix milliseconds used for replay-cache cleanup and fallback expiry only;
 * challenge verification uses the library's clock.
 * @throws Propagates module loading and missing-secret errors before verification.
 */
export async function verifyAltchaPayload(value: unknown, now = Date.now()): Promise<boolean> {
  const payload = parsePayload(value);
  if (!payload) return false;
  const { verifySolution, deriveKey } = await altcha();
  const { signature, keySignature } = secrets();
  try {
    const result = await verifySolution({
      ...payload,
      deriveKey,
      hmacSignatureSecret: signature,
      hmacKeySignatureSecret: keySignature,
    });
    if (!result.verified) return false;
  } catch {
    return false;
  }
  const { nonce, expiresAt } = payload.challenge.parameters;
  // Signed challenges always carry an expiry (seconds); fall back to the configured lifetime.
  const expiry =
    typeof expiresAt === 'number'
      ? expiresAt * 1000
      : now + CONFIG.kontakt.altcha.expiresMinutes * 60_000;
  return markUsed(nonce, expiry, now);
}
