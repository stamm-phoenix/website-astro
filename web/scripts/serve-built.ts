/**
 * Serves the built site (`dist/`) with the demo API and the simulated login of `dev/mockApi.ts`,
 * like `bun run dev:mock` but without Vite: pages are not compiled on their first request. The
 * routes, rewrites and headers come from `staticwebapp.config.json` (`scripts/built-site.ts`).
 *
 * Build first with the test data (`CONTENT_SOURCE=mock`, the default), then:
 *   bun run build && bun run start:mock -- --port 4321
 *
 * Demo writes stay in this process until it stops, as on the dev server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
const { mockApiMiddleware } = await import('../dev/mockApi');
const mockApi = mockApiMiddleware();

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
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/.auth/');
  if (isApi) {
    // Routes such as `/.auth/login/github` (404) apply before the API, as on Azure
    const matched = matchRoute(config, pathname);
    if (!matched?.redirect && !(matched?.statusCode && matched.statusCode >= 400)) {
      for (const [name, value] of Object.entries({ ...config.globalHeaders, ...matched?.headers }))
        response.setHeader(name, value);
      mockApi(request, response, () => response.writeHead(404).end());
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
  process.on(signal, () => server.close(() => process.exit(0)));
}
