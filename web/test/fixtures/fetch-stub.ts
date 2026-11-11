/** A stand-in for `fetch` that unit tests of stores steer, so an answer can be held back or sent late. */

export interface Gate<T = void> {
  promise: Promise<T>;
  open(value: T): void;
}

/** A promise a test settles by hand, to let an answer arrive at a chosen moment. */
export function gate<T = void>(): Gate<T> {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => (open = resolve));
  return { promise, open };
}

export interface StubbedCall {
  method: string;
  /** The endpoint without the `/api` prefix, with its query. */
  path: string;
  body: unknown;
}

export type StubAnswer = Response | Promise<Response>;

/** An answer with a JSON body. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Replaces `fetch` until `restore()`. Every request goes to `answer`; the returned list holds
 * the requests in the order they started, also those whose answer is still held back.
 */
export function stubFetch(answer: (call: StubbedCall) => StubAnswer): {
  calls: StubbedCall[];
  restore(): void;
} {
  const original = globalThis.fetch;
  const calls: StubbedCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call: StubbedCall = {
      method: init.method ?? 'GET',
      path: url.replace(/^\/api/, ''),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
