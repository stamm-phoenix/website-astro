import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpResponseInit } from '@azure/functions';

interface Timings {
  values: Map<string, number>;
}
const storage = new AsyncLocalStorage<Timings>();

/** Records only numeric durations, never statements, account names or credentials. */
export function addTiming(name: string, duration: number): void {
  const values = storage.getStore()?.values;
  if (values) values.set(name, (values.get(name) ?? 0) + duration);
}

export async function measureTiming<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    addTiming(name, performance.now() - start);
  }
}

/** Nested handlers share the request context; simultaneous requests never share timings. */
export async function withServerTiming(
  work: () => Promise<HttpResponseInit>
): Promise<HttpResponseInit> {
  if (storage.getStore()) return work();
  return storage.run({ values: new Map() }, async () => {
    const response = await measureTiming('total', work);
    const headers =
      response.headers && !(response.headers instanceof Headers) && !Array.isArray(response.headers)
        ? { ...response.headers }
        : Object.fromEntries(new Headers(response.headers).entries());
    headers['Server-Timing'] = [...storage.getStore()!.values]
      .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
      .join(', ');
    return { ...response, headers };
  });
}
