import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { addTiming, withServerTiming } from '../lib/server-timing';
import { withErrorHandling } from '../lib/response-utils';

test('internal responses include timings and retain existing headers', async () => {
  const handler = withErrorHandling(async () => ({
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  }));
  const response = await handler(
    new HttpRequest({ method: 'GET', url: 'https://example.test/api/intern/favoriten' }),
    new InvocationContext()
  );
  const headers = new Headers(response.headers);
  assert.match(headers.get('Server-Timing') ?? '', /total;dur=\d/);
  assert.equal(headers.get('Cache-Control'), 'no-store');
});

test('internal error responses include timings', async () => {
  const handler = withErrorHandling(async () => {
    throw new Error('test');
  });
  const response = await handler(
    new HttpRequest({ method: 'GET', url: 'https://example.test/api/intern/favoriten' }),
    new InvocationContext()
  );
  assert.equal(response.status, 500);
  assert.match(new Headers(response.headers).get('Server-Timing') ?? '', /total;dur=\d/);
});

test('concurrent requests keep their timings separate', async () => {
  const responses = await Promise.all(
    [11, 22].map((duration) =>
      withServerTiming(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        addTiming('query', duration);
        return { status: 200 };
      })
    )
  );
  assert.match(new Headers(responses[0].headers).get('Server-Timing')!, /query;dur=11.0/);
  assert.match(new Headers(responses[1].headers).get('Server-Timing')!, /query;dur=22.0/);
});
