import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { KontaktChallengeEndpoint, KontaktSendEndpoint } from '../endpoints/kontakt';
import { CONFIG } from '../lib/config';
import * as mail from '../lib/mail';
import { kontaktStammMail, resetKontaktQuota } from '../lib/kontakt';
import { validateKontaktMessage } from '../lib/kontakt-validation';
import type { KontaktMessage } from '../lib/kontakt-validation';
import { overrideConfig } from './fixtures/config';

const MESSAGE: KontaktMessage = {
  name: 'Erika Muster',
  email: 'erika@example.test',
  topic: 'gruppenstunden',
  message: 'Wann ist die nächste Schnupperstunde?\nViele Grüße',
};

interface SentMail {
  to: string;
  subject: string;
  html: string;
  sender?: string;
  replyTo?: mail.MailReplyTo;
}

function setup(t: TestContext, failing: 'none' | 'message' | 'receipt' = 'none'): SentMail[] {
  const previous = process.env.KONTAKT_ALTCHA_SECRET;
  process.env.KONTAKT_ALTCHA_SECRET = 'test-secret-longer-than-thirty-two-characters';
  t.after(() => {
    if (previous === undefined) delete process.env.KONTAKT_ALTCHA_SECRET;
    else process.env.KONTAKT_ALTCHA_SECRET = previous;
  });
  // Keep the proof of work cheap in tests.
  overrideConfig(t, CONFIG.kontakt, {
    altcha: { cost: 1, minCounter: 1, maxCounter: 10, expiresMinutes: 60 },
  });
  resetKontaktQuota();
  const sent: SentMail[] = [];
  t.mock.method(
    mail,
    'sendMail',
    async (
      to: string,
      subject: string,
      html: string,
      sender?: string,
      replyTo?: mail.MailReplyTo
    ) => {
      const isMessage = to === CONFIG.kontakt.mailbox;
      if ((failing === 'message' && isMessage) || (failing === 'receipt' && !isMessage))
        throw new Error('Graph down');
      sent.push({ to, subject, html, sender, replyTo });
    }
  );
  return sent;
}

function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'warn', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

async function solvedPayload(): Promise<string> {
  const challengeResponse = await KontaktChallengeEndpoint();
  assert.equal(challengeResponse.status, 200);
  const { solveChallenge } = await import('altcha-lib');
  const { deriveKey } = await import('altcha-lib/algorithms/pbkdf2');
  const challenge = challengeResponse.jsonBody as Parameters<typeof solveChallenge>[0]['challenge'];
  const solution = await solveChallenge({ challenge, deriveKey });
  assert.ok(solution);
  return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}

function post(body: unknown): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/kontakt',
    method: 'POST',
    body: { string: JSON.stringify(body) },
  });
}

test('validates all fields and rejects line breaks in the name', () => {
  assert.deepEqual(validateKontaktMessage({ ...MESSAGE, name: '  Erika  ' }).message, {
    ...MESSAGE,
    name: 'Erika',
  });
  const { message, errors } = validateKontaktMessage({
    name: 'Erika\nBcc: x',
    email: 'no-address',
    topic: 'werbung',
    message: 'kurz',
  });
  assert.equal(message, null);
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'message', 'name', 'topic']);
});

test('sends the message to the Stamm with Reply-To and a receipt without the text', async (t) => {
  const sent = setup(t);
  const response = await KontaktSendEndpoint(
    post({ ...MESSAGE, altcha: await solvedPayload() }),
    context(t)
  );
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);

  const [toStamm, receipt] = sent;
  assert.equal(toStamm.to, CONFIG.kontakt.mailbox);
  assert.equal(toStamm.sender, CONFIG.kontakt.mailbox);
  assert.deepEqual(toStamm.replyTo, { address: MESSAGE.email, name: MESSAGE.name });
  assert.match(toStamm.subject, /Gruppenstunden/);
  assert.match(toStamm.html, /Schnupperstunde\?<br \/>Viele Grüße/);

  assert.equal(receipt.to, MESSAGE.email);
  assert.equal(receipt.sender, CONFIG.kontakt.mailbox);
  assert.doesNotMatch(receipt.html, /Schnupperstunde|Erika/);
});

test('escapes HTML in the message to the Stamm', () => {
  const { html } = kontaktStammMail({ ...MESSAGE, name: '<b>x</b>', message: '<script>' });
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!html.includes('<script>') && !html.includes('<b>x</b>'));
});

test('rejects a missing, forged or reused proof of work', async (t) => {
  const sent = setup(t);
  for (const altcha of [undefined, 'bm90IGpzb24=', Buffer.from('{}').toString('base64')]) {
    const response = await KontaktSendEndpoint(post({ ...MESSAGE, altcha }), context(t));
    assert.equal(response.status, 403);
  }

  const payload = await solvedPayload();
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  decoded.challenge.parameters.cost = 2;
  const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
  assert.equal(
    (await KontaktSendEndpoint(post({ ...MESSAGE, altcha: tampered }), context(t))).status,
    403
  );

  assert.equal(
    (await KontaktSendEndpoint(post({ ...MESSAGE, altcha: payload }), context(t))).status,
    200
  );
  assert.equal(
    (await KontaktSendEndpoint(post({ ...MESSAGE, altcha: payload }), context(t))).status,
    403
  );
  assert.equal(sent.length, 2);
});

test('pretends success for the honeypot and reports invalid fields', async (t) => {
  const sent = setup(t);
  const honeypot = await KontaktSendEndpoint(
    post({ ...MESSAGE, website: 'http://spam.test', altcha: await solvedPayload() }),
    context(t)
  );
  assert.equal(honeypot.status, 200);

  const invalid = await KontaktSendEndpoint(
    post({ ...MESSAGE, email: 'kaputt', altcha: await solvedPayload() }),
    context(t)
  );
  assert.equal(invalid.status, 400);
  assert.ok((invalid.jsonBody as { fields: Record<string, string> }).fields.email);
  assert.equal(sent.length, 0);
});

test('stops at the hourly limit', async (t) => {
  const sent = setup(t);
  overrideConfig(t, CONFIG.kontakt, { hourlyLimit: 1 });
  assert.equal(
    (await KontaktSendEndpoint(post({ ...MESSAGE, altcha: await solvedPayload() }), context(t)))
      .status,
    200
  );
  assert.equal(
    (await KontaktSendEndpoint(post({ ...MESSAGE, altcha: await solvedPayload() }), context(t)))
      .status,
    429
  );
  assert.equal(sent.length, 2);
});

test('fails when the message to the Stamm cannot be sent', async (t) => {
  const sentFailing = setup(t, 'message');
  const failed = await KontaktSendEndpoint(
    post({ ...MESSAGE, altcha: await solvedPayload() }),
    context(t)
  );
  assert.equal(failed.status, 502);
  assert.equal(sentFailing.length, 0);
});

test('reports success when only the receipt fails', async (t) => {
  const sent = setup(t, 'receipt');
  const response = await KontaktSendEndpoint(
    post({ ...MESSAGE, altcha: await solvedPayload() }),
    context(t)
  );
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, CONFIG.kontakt.mailbox);
});

test('is unavailable without the ALTCHA secret', async (t) => {
  const previous = process.env.KONTAKT_ALTCHA_SECRET;
  delete process.env.KONTAKT_ALTCHA_SECRET;
  t.after(() => {
    if (previous !== undefined) process.env.KONTAKT_ALTCHA_SECRET = previous;
  });
  assert.equal((await KontaktChallengeEndpoint()).status, 503);
  assert.equal((await KontaktSendEndpoint(post(MESSAGE), context(t))).status, 503);
});
