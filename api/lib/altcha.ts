import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type * as AltchaLib from 'altcha-lib' with { 'resolution-mode': 'import' };
import type { Challenge, DeriveKeyFunction, Solution } from 'altcha-lib' with {
  'resolution-mode': 'import',
};
import { CONFIG } from './config';
import { EnvironmentVariable, findEnvironment, getEnvironment } from './environment';

/**
 * Self-hosted ALTCHA proof of work: the browser computes a PBKDF2 key before it may submit
 * a public form (Kontakt, Nikolaus booking, Sammelbestellung link request). No third party is
 * involved, so the widget needs no consent. All forms share one challenge endpoint and secret
 * (`KONTAKT_ALTCHA_SECRET`, named after the first form); each solution is accepted only once.
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

/** Loads the challenge and PBKDF2 helpers; module import failures propagate to the caller. */
async function altcha(): Promise<AltchaFunctions> {
  const [{ createChallenge, randomInt, verifySolution }, { deriveKey }] = await Promise.all([
    import('altcha-lib'),
    import('altcha-lib/algorithms/pbkdf2'),
  ]);
  return { createChallenge, randomInt, verifySolution, deriveKey };
}

/**
 * Returns the configured signing secret and the key-signing secret derived from it.
 * @throws Error if KONTAKT_ALTCHA_SECRET is missing or empty.
 */
function secrets(): { signature: string; keySignature: string } {
  const signature = getEnvironment(EnvironmentVariable.KONTAKT_ALTCHA_SECRET);
  // A second secret for the derived key, without another App Setting.
  const keySignature = createHmac('sha256', signature).update('altcha-key-signature').digest('hex');
  return { signature, keySignature };
}

/** Whether the secret is configured; without it, no challenge can be created or verified. */
export function isAltchaConfigured(): boolean {
  return Boolean(findEnvironment(EnvironmentVariable.KONTAKT_ALTCHA_SECRET));
}

/**
 * Creates a signed PBKDF2 challenge with the configured cost, counter range, and lifetime.
 * @param now Unix time in milliseconds from which the challenge lifetime is measured.
 * @throws Propagates module loading, missing-secret, and challenge creation errors.
 */
export async function createAltchaChallenge(now = Date.now()): Promise<AltchaChallenge> {
  const { createChallenge, randomInt, deriveKey } = await altcha();
  const { signature, keySignature } = secrets();
  const { cost, minCounter, maxCounter, expiresMinutes } = CONFIG.altcha;
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

const MAX_PAYLOAD_LENGTH = 10_000;

/** The outer shape of the decoded payload; the signatures and the solution are checked later. */
const payloadSchema = z.object({
  challenge: z.looseObject({ parameters: z.looseObject({ nonce: z.string() }) }),
  // Any object, an array included: the verifier decides whether it solves the challenge
  solution: z.custom<Solution>((solution) => !!solution && typeof solution === 'object'),
});

/**
 * Decodes the widget's base64 JSON payload and checks its outer shape and string nonce.
 * Returns null for non-strings, strings over 10,000 code units, decoding/JSON errors, or
 * missing structure; signatures and the solution are not verified here.
 */
function parsePayload(value: unknown): { challenge: Challenge; solution: Solution } | null {
  if (typeof value !== 'string' || value.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const payload = payloadSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64').toString('utf8'))
    );
    // The loose objects keep the fields the verifier needs (signature, expiry, algorithm)
    return payload.success
      ? (payload.data as unknown as { challenge: Challenge; solution: Solution })
      : null;
  } catch {
    return null;
  }
}

/**
 * Records a nonce after dropping entries whose expiry is at or before now; returns false
 * if the nonce is still cached. Evicts the oldest entry when the cache is full.
 * @param expiresAt Nonce expiry as Unix time in milliseconds.
 * @param now Unix time in milliseconds used to remove expired entries.
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
 * Verifies the widget's base64 JSON payload and records its nonce in this instance's
 * bounded replay cache. Returns false for malformed payloads, failed or throwing
 * verification, or a nonce still in the cache. Cache eviction can allow reuse.
 * @param now Unix time in milliseconds for cache cleanup and fallback expiry; it does
 * not override the verifier's clock.
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
    typeof expiresAt === 'number' ? expiresAt * 1000 : now + CONFIG.altcha.expiresMinutes * 60_000;
  return markUsed(nonce, expiry, now);
}
