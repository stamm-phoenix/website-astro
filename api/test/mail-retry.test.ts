import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from '@microsoft/microsoft-graph-client';
import * as token from '../lib/token';
import { sendMail } from '../lib/mail';

test('durable reminders disable Graph transport retries while other mail keeps existing defaults', async (t) => {
  let options: unknown[] = [];
  let calls = 0;
  const request = {
    middlewareOptions: (value: unknown[]) => {
      options = value;
      return request;
    },
    options: () => request,
    post: async () => {
      calls++;
    },
  };
  t.mock.method(token, 'getClient', () => ({ api: () => request }) as unknown as Client);
  await sendMail('test@example.test', 'Test', '<p>Test</p>');
  assert.equal(options.length, 0);
  await sendMail('test@example.test', 'Test', '<p>Test</p>', undefined, undefined, {
    retry: false,
    timeoutMs: 10000,
  });
  assert.equal((options[0] as { maxRetries: number }).maxRetries, 0);
  assert.equal(calls, 2);
});
