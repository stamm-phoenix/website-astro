/**
 * Where the build gets the content to bake (`CONTENT_SOURCE`):
 * - `live`: the production API (`CONTENT_API_URL`, default https://stamm-phoenix.de), used by
 *   builds of `main` and the content refresh.
 * - `mock`: the test data of `dev/mockApi.ts`, without a server; default for local builds,
 *   the dev server and PR previews, so previews never hold copies of real photos.
 * - `none`: nothing is baked; the pages load everything in the browser as before.
 *
 * `CONTENT_STRICT` makes a failed request fail the build instead of leaving the content out:
 * `1` for every source, or a comma-separated list of source names (the content refresh passes
 * the sources the deployed site has, so it never removes content but can still deploy while
 * another source is down).
 */

import type { ContentSourceName } from './version';

export type ContentSourceKind = 'live' | 'mock' | 'none';

export interface SourceResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

const DEFAULT_API_URL = 'https://stamm-phoenix.de';
const TIMEOUT_MS = 20_000;
const MAX_PARALLEL = 6;

export function getContentSource(): ContentSourceKind {
  const value = process.env.CONTENT_SOURCE ?? 'mock';
  if (value === 'live' || value === 'mock' || value === 'none') return value;
  throw new Error(`Unknown CONTENT_SOURCE "${value}" (expected live, mock or none)`);
}

/** Whether a failure of the source `name` must fail the build. */
export function isStrict(name: ContentSourceName): boolean {
  const value = process.env.CONTENT_STRICT?.trim() ?? '';
  if (value === '1') return true;
  return value.split(',').some((entry) => entry.trim() === name);
}

let running = 0;
const queue: (() => void)[] = [];

/** Limits parallel requests, so baking many images does not flood the API. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    queue.shift()?.();
  }
}

async function fetchLive(path: string): Promise<SourceResponse> {
  const base = (process.env.CONTENT_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
  return limited(async () => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'stamm-phoenix-website-build' },
    });
    return {
      status: response.status,
      contentType: response.headers.get('Content-Type') ?? '',
      body: new Uint8Array(await response.arrayBuffer()),
    };
  });
}

async function fetchMock(path: string): Promise<SourceResponse> {
  // Loaded only when needed; the test data never reaches a page that bakes live content
  const { handleMockGet } = await import('../../../dev/mockApi');
  return handleMockGet(path);
}

/** A GET request to an API path (`/api/...`, with query) of the configured source. */
export function fetchFromSource(path: string): Promise<SourceResponse> {
  const source = getContentSource();
  if (source === 'none') return Promise.reject(new Error('CONTENT_SOURCE is none'));
  return source === 'live' ? fetchLive(path) : fetchMock(path);
}
