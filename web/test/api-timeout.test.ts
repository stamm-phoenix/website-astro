import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ApiError, fetchApi, sendApi } from '../src/lib/api';
import { READ_TIMEOUT_MESSAGE, TIMEOUT_MS, WRITE_TIMEOUT_MESSAGE } from '../src/lib/apiTimeout';

const limits = TIMEOUT_MS as { read: number; write: number; file: number };
const originalFetch = globalThis.fetch;
const originalLimits = { ...limits };
let calls = 0;

/** A server that never answers; the request ends only when its signal aborts. */
function hang(): void {
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
      );
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = 0;
  limits.read = limits.write = 20;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(limits, originalLimits);
});

test('a read that times out is sent once more, then fails with a readable message', async () => {
  hang();
  await assert.rejects(fetchApi('/events'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.message, READ_TIMEOUT_MESSAGE);
    return true;
  });
  assert.equal(calls, 2);
});

test('a write that times out is never repeated and tells the user to check first', async () => {
  hang();
  await assert.rejects(sendApi('POST', '/intern/pflege/blog', { a: 1 }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, WRITE_TIMEOUT_MESSAGE);
    return true;
  });
  assert.equal(calls, 1);
});

test('aborting by the caller is not retried and stays an abort', async () => {
  hang();
  const controller = new AbortController();
  const result = fetchApi('/events', controller.signal);
  controller.abort();
  await assert.rejects(result, (error: unknown) => !(error instanceof ApiError));
  assert.equal(calls, 1);
});

test('a lost connection is retried once for reads', async () => {
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return new Response('{"ok":true}');
  }) as typeof fetch;
  assert.deepEqual(await fetchApi('/events'), { ok: true });
  assert.equal(calls, 2);
});

test('aborting after the headers arrived still aborts the body read', async () => {
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    calls++;
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
      },
    });
    return Promise.resolve(new Response(body));
  }) as typeof fetch;
  const controller = new AbortController();
  const result = fetchApi('/events', controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(result, (error: unknown) => !(error instanceof ApiError));
  assert.equal(calls, 1);
});

test('a read that breaks while the body arrives is sent once more', async () => {
  globalThis.fetch = (async () => {
    calls++;
    if (calls > 1) return new Response('{"ok":true}');
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    return new Response(body);
  }) as typeof fetch;
  assert.deepEqual(await fetchApi('/events'), { ok: true });
  assert.equal(calls, 2);
});
