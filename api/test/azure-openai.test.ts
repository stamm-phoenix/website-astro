import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as token from '../lib/token';
import { AzureOpenAiError, requestStructuredOutput } from '../lib/azure-openai';

const DEPLOYMENT = { endpoint: 'https://example.openai.azure.com', deployment: 'test' };
const REQUEST = {
  schemaName: 'test',
  schema: { type: 'object' },
  messages: [{ role: 'user' as const, content: 'private minutes' }],
  maxCompletionTokens: 100,
  timeoutMs: 20,
};

function key(t: TestContext, value?: string): void {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  if (value === undefined) delete process.env.AZURE_OPENAI_API_KEY;
  else process.env.AZURE_OPENAI_API_KEY = value;
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
}

test('the deadline covers credential acquisition and prevents a late model call', async (t) => {
  key(t);
  let finishToken: ((value: { token: string; expiresOnTimestamp: number }) => void) | undefined;
  const credential = {
    getToken: () =>
      new Promise<{ token: string; expiresOnTimestamp: number }>((resolve) => {
        finishToken = resolve;
      }),
  };
  t.mock.method(token, 'getCredential', () => credential);
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No fetch expected');
  });
  await assert.rejects(requestStructuredOutput(DEPLOYMENT, REQUEST), /timed out/);
  assert.ok(finishToken);
  finishToken({ token: 'late-token', expiresOnTimestamp: Date.now() + 10000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 0);
});

test('the deadline also covers a response body that never completes', async (t) => {
  key(t, 'test-key');
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    const response = new Response('{}');
    t.mock.method(response, 'json', () => new Promise<unknown>(() => undefined));
    return response;
  });
  await assert.rejects(requestStructuredOutput(DEPLOYMENT, REQUEST), /timed out/);
  assert.equal(signal?.aborted, true);
});

test('HTTP errors contain only a numeric status, not upstream text or prompts', async (t) => {
  key(t, 'test-key');
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('private answer', {
        status: 429,
        statusText: 'private minutes',
      })
  );
  await assert.rejects(
    requestStructuredOutput(DEPLOYMENT, REQUEST),
    (error: Error) =>
      error instanceof AzureOpenAiError && error.message === 'Azure OpenAI request failed: 429'
  );
});
