/**
 * Serves the built site (`dist/`) with the demo API and the simulated login of `dev/mockApi.ts`,
 * like `bun run dev:mock` but without Vite: pages are not compiled on their first request. The
 * routes, rewrites and headers come from `staticwebapp.config.json` (`scripts/built-site.ts`).
 *
 * Build first with the test data (`CONTENT_SOURCE=mock`, the default), then:
 *   bun run build && bun run start:mock -- --port 4321
 *
 * Demo writes stay in this process until it stops, as on the dev server. With `--fresh-state`
 * (browser tests, `scripts/e2e-servers.ts`) the demo API runs in a worker thread instead, and
 * `POST /__e2e/fresh-state` swaps in one with the initial data (`scripts/mock-state.ts`).
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  contentType,
  matchRoute,
  resolveBuilt,
  type BuiltResponse,
  type SwaConfig,
} from './built-site';
import { FreshMockState, type MockInstance } from './mock-state';

// The demo API loads the validators of api/lib, which import zod from web/node_modules (the CI
// installs only web/). Bun finds it through NODE_PATH; `start:mock` sets it, together with
// --no-install, so Bun never downloads another version on its own.
if (!process.env.NODE_PATH) {
  console.error('Start with `bun run start:mock`, which sets NODE_PATH for the demo API.');
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4321' },
    host: { type: 'string', default: '127.0.0.1' },
    dist: { type: 'string', default: 'dist' },
    'fresh-state': { type: 'boolean', default: false },
  },
});
const port = Number(values.port);
const dist = resolve(values.dist);
const configFile = resolve(dist, 'staticwebapp.config.json');
if (!existsSync(configFile)) {
  console.error(`${configFile} is missing; build the site first (bun run build).`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(configFile, 'utf8')) as SwaConfig;

/** Loads one instance of the demo API in a worker thread; resolves when it listens. */
function spawnInstance(): Promise<MockInstance> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mock-instance.ts', import.meta.url).href);
    worker.addEventListener('message', (event: MessageEvent<number>) =>
      resolve({ port: event.data, stop: () => worker.terminate() })
    );
    worker.addEventListener('error', (event) => {
      console.error('[mock-state] Demo API instance failed:', event.message);
      reject(new Error(event.message));
    });
  });
}

// Headers of one connection, which the proxy must not pass on
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

/** Passes a request to the demo API instance on `target` and its answer back. */
function proxy(request: IncomingMessage, response: ServerResponse, target: number): void {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: target,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (answer) => {
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) response.setHeader(name, value);
      }
      response.writeHead(answer.statusCode ?? 502);
      answer.pipe(response);
    }
  );
  upstream.on('error', (error) => {
    console.error('[mock-state] Request to the demo API failed:', error.message);
    if (response.headersSent) response.end();
    else response.writeHead(502).end();
  });
  request.pipe(upstream);
}

const freshState = values['fresh-state'] ? new FreshMockState(spawnInstance) : null;
const inProcess = freshState ? null : (await import('../dev/mockApi')).mockApiMiddleware();

function answerApi(request: IncomingMessage, response: ServerResponse): void {
  if (inProcess) {
    inProcess(request, response, () => response.writeHead(404).end());
    return;
  }
  freshState!.port().then(
    (target) => proxy(request, response, target),
    () => response.writeHead(502).end()
  );
}

const exists = (file: string): boolean => {
  try {
    return statSync(resolve(dist, file)).isFile();
  } catch {
    return false;
  }
};

function send(request: IncomingMessage, response: ServerResponse, answer: BuiltResponse): void {
  for (const [name, value] of Object.entries(answer.headers)) response.setHeader(name, value);
  if (answer.kind === 'redirect') {
    response.writeHead(answer.status, { Location: answer.location }).end();
    return;
  }
  if (answer.kind === 'empty') {
    response.writeHead(answer.status).end();
    return;
  }
  const path = resolve(dist, answer.file);
  response.writeHead(answer.status, {
    'Content-Type': contentType(config, answer.file),
    'Content-Length': statSync(path).size,
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (freshState && pathname === '/__e2e/fresh-state' && request.method === 'POST') {
    freshState.fresh().then(
      () => response.writeHead(204).end(),
      (error: unknown) => response.writeHead(500).end(String(error))
    );
    return;
  }
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/.auth/');
  if (isApi) {
    // Routes such as `/.auth/login/github` (404) apply before the API, as on Azure
    const matched = matchRoute(config, pathname);
    if (!matched?.redirect && !(matched?.statusCode && matched.statusCode >= 400)) {
      for (const [name, value] of Object.entries({ ...config.globalHeaders, ...matched?.headers }))
        response.setHeader(name, value);
      answerApi(request, response);
      return;
    }
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  send(request, response, resolveBuilt(config, pathname, exists));
});

server.listen(port, values.host, () => {
  // scripts/e2e-servers.ts waits for this line
  console.log(`Built site with demo API on http://${values.host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void freshState?.close();
    server.close(() => process.exit(0));
  });
}
