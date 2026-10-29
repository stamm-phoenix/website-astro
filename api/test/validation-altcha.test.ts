import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAltchaPayload } from '../lib/altcha';
import { EnvironmentVariable } from '../lib/environment';
import { solvedAltcha, useAltcha } from './fixtures/altcha';

// Without the secret, a payload of the right shape gets past the parser and then fails on the
// missing secret, while a malformed one is refused with `false` before that.

const encode = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
const challenge = { parameters: { nonce: 'n', expiresAt: 1 }, signature: 's' };

async function withoutSecret(run: () => Promise<void>): Promise<void> {
  const saved = process.env[EnvironmentVariable.KONTAKT_ALTCHA_SECRET];
  delete process.env[EnvironmentVariable.KONTAKT_ALTCHA_SECRET];
  try {
    await run();
  } finally {
    if (saved !== undefined) process.env[EnvironmentVariable.KONTAKT_ALTCHA_SECRET] = saved;
  }
}

test('verifyAltchaPayload refuses payloads of the wrong shape', async () => {
  await withoutSecret(async () => {
    const malformed: unknown[] = [
      undefined,
      null,
      5,
      {},
      'x'.repeat(10_001),
      'not json',
      encode(null),
      encode(5),
      encode('x'),
      encode([]),
      encode({}),
      encode({ solution: {} }),
      encode({ challenge, solution: null }),
      encode({ challenge, solution: 'x' }),
      encode({ challenge, solution: 0 }),
      encode({ challenge }),
      encode({ challenge: null, solution: {} }),
      encode({ challenge: 'x', solution: {} }),
      encode({ challenge: [], solution: {} }),
      encode({ challenge: {}, solution: {} }),
      encode({ challenge: { parameters: null }, solution: {} }),
      encode({ challenge: { parameters: 'x' }, solution: {} }),
      encode({ challenge: { parameters: [] }, solution: {} }),
      encode({ challenge: { parameters: {} }, solution: {} }),
      encode({ challenge: { parameters: { nonce: 5 } }, solution: {} }),
    ];
    for (const value of malformed) {
      assert.equal(await verifyAltchaPayload(value), false, String(value).slice(0, 40));
    }
  });
});

test('verifyAltchaPayload lets payloads of the right shape reach the verification', async () => {
  await withoutSecret(async () => {
    const wellFormed = [
      encode({ challenge, solution: {} }),
      encode({ challenge: { parameters: { nonce: '' } }, solution: { counter: 1 } }),
      encode({ challenge, solution: [] }),
      'x'.repeat(10_000).length === 10_000 ? encode({ challenge, solution: {}, extra: 1 }) : '',
    ];
    for (const value of wellFormed) {
      await assert.rejects(() => verifyAltchaPayload(value), /Missing environment variable/);
    }
  });
});

test('verifyAltchaPayload accepts a solved challenge once', async (t) => {
  useAltcha(t);
  const payload = await solvedAltcha();
  assert.equal(await verifyAltchaPayload(payload), true);
  assert.equal(await verifyAltchaPayload(payload), false);
});
