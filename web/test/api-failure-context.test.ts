import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchApi, getLastApiFailure } from '../src/lib/api';
import { problemMeldenHref } from '../src/lib/problemMelden';

test('an expired-login redirect replaces the previous API failure context', async () => {
  const originalFetch = globalThis.fetch;
  const redirect = new Response(null);
  Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' });
  const responses = [
    new Response(JSON.stringify({ code: 'INTERNAL', message: 'Fehler' }), {
      status: 500,
      headers: { 'x-request-id': 'old-request' },
    }),
    redirect,
  ];
  globalThis.fetch = (async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;
  try {
    await assert.rejects(fetchApi('/intern/pflege/belege'), { status: 500 });
    assert.equal(getLastApiFailure()?.code, 'INTERNAL');
    await assert.rejects(fetchApi('/intern/pflege/aktionen?filter=offen'), { status: 401 });
    const failure = getLastApiFailure();
    assert.equal(failure?.status, 401);
    assert.equal(failure?.route, '/api/intern/pflege/aktionen');
    assert.equal(failure?.code, '');
    assert.equal(failure?.correlationId, '');
    const href = new URL(problemMeldenHref(), 'https://example.test');
    assert.equal(href.searchParams.get('status'), '401');
    assert.equal(href.searchParams.get('route'), '/api/intern/pflege/aktionen');
    assert.equal(href.searchParams.get('code'), null);
    assert.equal(href.searchParams.get('korrelation'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
