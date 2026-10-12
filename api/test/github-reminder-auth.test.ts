import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { verifyTaskReminderToken } from '../lib/github-reminder-auth';
import * as auth from '../lib/github-reminder-auth';
import * as worker from '../lib/aufgaben-erinnerungen';
import { TaskReminderEndpoint } from '../endpoints/automation-aufgaben-erinnerungen';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'reminder-test' };
function claims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: CONFIG.taskReminders.oidcAudience,
    sub: `repo:${CONFIG.taskReminders.repository}:ref:refs/heads/main`,
    repository: CONFIG.taskReminders.repository,
    ref: 'refs/heads/main',
    event_name: 'schedule',
    workflow_ref: `${CONFIG.taskReminders.repository}/${CONFIG.taskReminders.workflow}@refs/heads/main`,
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
  };
}
function jwt(payload = claims(), header = { alg: 'RS256', kid: key.kid }): string {
  const data = [header, payload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
    .join('.');
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), pair.privateKey).toString('base64url')}`;
}

test('only a cryptographically signed scheduled main workflow identity is accepted', async (t) => {
  const fetchKeys = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ keys: [key] }))
  );
  assert.equal(await verifyTaskReminderToken(jwt()), true);
  for (const change of [
    { repository: 'attacker/website-astro' },
    { ref: 'refs/heads/feature' },
    { event_name: 'pull_request' },
    { event_name: 'workflow_dispatch' },
    { sub: 'repo:stamm-phoenix/website-astro:pull_request' },
    {
      workflow_ref: `${CONFIG.taskReminders.repository}/.github/workflows/other.yml@refs/heads/main`,
    },
    { aud: 'another-service' },
    { iss: 'https://attacker.example' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { iat: Math.floor(Date.now() / 1000) + 300 },
    { nbf: Math.floor(Date.now() / 1000) + 300 },
    { exp: Math.floor(Date.now() / 1000) + 3600 },
  ])
    assert.equal(await verifyTaskReminderToken(jwt({ ...claims(), ...change })), false);
  assert.equal(await verifyTaskReminderToken(jwt(claims(), { alg: 'HS256', kid: key.kid })), false);
  assert.equal(
    await verifyTaskReminderToken(jwt(claims(), { alg: 'RS256', kid: 'unknown-key' })),
    false
  );
  const valid = jwt();
  const parts = valid.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 1;
  assert.equal(
    await verifyTaskReminderToken(`${parts[0]}.${parts[1]}.${signature.toString('base64url')}`),
    false
  );
  assert.equal(await verifyTaskReminderToken(null), false);
  assert.equal(await verifyTaskReminderToken('not-a-jwt'), false);
  assert.equal(await verifyTaskReminderToken('x'.repeat(20000)), false);
  assert.equal(fetchKeys.mock.callCount(), 1);
});
test('missing or forged machine credentials cannot trigger task reads or mail delivery', async (t) => {
  const run = t.mock.method(worker, 'runTaskReminders', async () => ({
    day: '2026-10-12',
    sent: 0,
    uncertain: 0,
    remaining: 0,
  }));
  const context = new InvocationContext({ functionName: 'task-reminder-test' });
  const headersList: Record<string, string>[] = [
    {},
    { 'x-task-reminder-token': 'bad-token' },
    {
      'x-ms-client-principal': Buffer.from(
        JSON.stringify({ userDetails: 'staff@stamm-phoenix.de' })
      ).toString('base64'),
    },
  ];
  for (const headers of headersList) {
    const response = await TaskReminderEndpoint(
      new HttpRequest({
        method: 'POST',
        url: 'https://example.test/api/automation/aufgaben-erinnerungen',
        headers,
      }),
      context
    );
    assert.equal(response.status, 401);
  }
  assert.equal(run.mock.callCount(), 0);
});
test('authenticated scheduler gets counts without recipients or task content; no user-supplied dates', async (t) => {
  t.mock.method(auth, 'verifyTaskReminderToken', async () => true);
  const run = t.mock.method(worker, 'runTaskReminders', async () => ({
    day: '2026-10-12',
    sent: 2,
    uncertain: 0,
    remaining: 1,
  }));
  const context = new InvocationContext({ functionName: 'task-reminder-test' });
  t.mock.method(context, 'log', () => undefined);
  const response = await TaskReminderEndpoint(
    new HttpRequest({
      method: 'POST',
      url: 'https://example.test/api/automation/aufgaben-erinnerungen',
      body: { string: JSON.stringify({ day: '2020-01-01', recipient: 'attacker@example.test' }) },
    }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { day: '2026-10-12', sent: 2, uncertain: 0, remaining: 1 });
  assert.equal(run.mock.callCount(), 1);
  assert.equal(run.mock.calls[0].arguments.length, 0);
});
