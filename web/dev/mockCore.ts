/** Request and result types, the route table and the response helpers of the demo API. */
import type { IncomingMessage } from 'node:http';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  raw: Buffer;
  /** Parsed JSON body, or `null` if the body is empty or not JSON. */
  json: Record<string, unknown> | null;
}

export type MockResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | {
      kind: 'raw';
      status: number;
      contentType: string;
      body: string | Uint8Array;
      headers?: Record<string, string>;
    }
  | { kind: 'redirect'; location: string };

export type Handler = (req: MockRequest) => MockResult;

interface Route {
  methods: string[];
  /** The path as registered, with `:name` segments. */
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Images and files are answered without artificial delay. */
  instant?: boolean;
}

export const routes: Route[] = [];

/** Registers a route; `:name` segments become `params.name`. */
export function route(
  methods: string | string[],
  path: string,
  handler: Handler,
  instant = false
): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, key: string) => {
        keys.push(key);
        return '([^/]+)';
      }) +
      '/?$'
  );
  routes.push({
    methods: Array.isArray(methods) ? methods : [methods],
    path,
    pattern,
    keys,
    handler,
    instant,
  });
}

/** Method and path of every registered route, for the check against the real API. */
export function mockRouteTable(): { methods: string[]; path: string }[] {
  return routes.map(({ methods, path }) => ({ methods, path }));
}

export const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
export const noContent = (): MockResult => ({ kind: 'empty', status: 204 });
export const error = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
): MockResult => json({ error: code, code, message, ...(fields ? { fields } : {}) }, status);
export const notFound = (message = 'Der Eintrag wurde nicht gefunden.'): MockResult =>
  error(404, 'NOT_FOUND', message);
export const svg = (body: string): MockResult => ({
  kind: 'raw',
  status: 200,
  contentType: 'image/svg+xml; charset=utf-8',
  body,
  headers: { 'Cache-Control': 'private, max-age=60' },
});
export const jpeg = (bytes: Uint8Array): MockResult => ({
  kind: 'raw',
  status: 200,
  contentType: 'image/jpeg',
  body: bytes,
});

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function wait(range: [number, number]): Promise<void> {
  const ms = (range[0] + range[1]) / 2;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
