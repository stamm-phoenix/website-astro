import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { AltchaChallengeEndpoint } from '../../endpoints/altcha';
import { CONFIG } from '../../lib/config';
import { overrideConfig } from './config';

export const TEST_ALTCHA_SECRET = 'test-secret-longer-than-thirty-two-characters';

/** Configures the ALTCHA secret and a cheap proof of work for one test. */
export function useAltcha(t: TestContext): void {
  const previous = process.env.KONTAKT_ALTCHA_SECRET;
  process.env.KONTAKT_ALTCHA_SECRET = TEST_ALTCHA_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.KONTAKT_ALTCHA_SECRET;
    else process.env.KONTAKT_ALTCHA_SECRET = previous;
  });
  overrideConfig(t, CONFIG, {
    altcha: { cost: 1, minCounter: 1, maxCounter: 10, expiresMinutes: 60 },
  });
}

/** Removes the ALTCHA secret for one test. */
export function withoutAltcha(t: TestContext): void {
  const previous = process.env.KONTAKT_ALTCHA_SECRET;
  delete process.env.KONTAKT_ALTCHA_SECRET;
  t.after(() => {
    if (previous !== undefined) process.env.KONTAKT_ALTCHA_SECRET = previous;
  });
}

/** Fetches a challenge and solves it like the widget does; returns its base64 payload. */
export async function solvedAltcha(): Promise<string> {
  const challengeResponse = await AltchaChallengeEndpoint();
  assert.equal(challengeResponse.status, 200);
  const { solveChallenge } = await import('altcha-lib');
  const { deriveKey } = await import('altcha-lib/algorithms/pbkdf2');
  const challenge = challengeResponse.jsonBody as Parameters<typeof solveChallenge>[0]['challenge'];
  const solution = await solveChallenge({ challenge, deriveKey });
  assert.ok(solution);
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}
