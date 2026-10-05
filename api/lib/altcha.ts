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

async function altcha(): Promise<AltchaFunctions> {
  const [{ createChallenge, randomInt, verifySolution }, { deriveKey }] = await Promise.all([
    import('altcha-lib'),
    import('altcha-lib/algorithms/pbkdf2'),
  ]);
  return { createChallenge, randomInt, verifySolution, deriveKey };
}

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

/** Records the nonce; `false` if it was used before. Drops expired nonces first. */
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
 * Verifies the payload the widget put into the form. Each payload is accepted once per
 * instance; together with the expiry this keeps a solved challenge from being reused.
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
