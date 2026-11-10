/**
 * One E2E server on one port: the built site (`dist/`) plus the mock API of `dev/mockApi.ts`.
 *
 * Unlike `dev:mock` it compiles nothing per route, so the first visit of a page costs nothing. It
 * does not provide what `bun run preview` lacks by itself: `/api/*`, `/.auth/*` and the rewrites
 * of the detail pages come from here.
 *
 * The state of the mock API lives in this process. `POST /__e2e/reset` ends the process with
 * `RESET_EXIT_CODE`; `e2e-servers.ts` starts a fresh one on the same port, so the next test sees
 * the demo data again. `GET /__e2e/instance` answers with an id that changes with every start, so
 * a test can wait until the new process answers.
 *
 * Run by `e2e-servers.ts`: `bun scripts/e2e-static-server.ts <port>` (after `bun run build`).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { mockApiMiddleware } from '../dev/mockApi';
import { RESET_EXIT_CODE } from './e2e-reset';

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  console.error('Usage: bun scripts/e2e-static-server.ts <port>');
  process.exit(1);
}
const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing; run `bun run build` first.');
  process.exit(1);
}

const instance = `${process.pid}-${Date.now()}`;
const mock = mockApiMiddleware();

// The detail pages of the Leitendenbereich are one page each, whatever the id (see
// staticwebapp.config.json and astro.config.mjs)
function rewrite(pathname: string): string {
  if (/^\/leitendenbereich\/sammelbestellungen\/\d+\/?$/.test(pathname)) {
    return '/leitendenbereich/sammelbestellungen/detail';
  }
  if (/^\/leitendenbereich\/abrechnung\/evt_[A-Za-z0-9]+\/?$/.test(pathname)) {
    return '/leitendenbereich/abrechnung/detail';
  }
  return pathname;
}

function fileFor(pathname: string): string | undefined {
  const relative = normalize(decodeURIComponent(rewrite(pathname))).replace(/^(\.\.[/\\])+/, '');
  const base = join(dist, relative);
  if (!base.startsWith(dist)) return undefined;
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webm': 'video/webm',
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/__e2e/instance') {
    response.setHeader('Content-Type', 'text/plain');
    response.end(instance);
    return;
  }
  if (url.pathname === '/__e2e/reset' && request.method === 'POST') {
    response.statusCode = 204;
    response.end(() => {
      // Close the port first, so the next process can bind it at once
      server.close(() => process.exit(RESET_EXIT_CODE));
      server.closeAllConnections();
    });
    return;
  }
  mock(request, response, () => {
    const file = fileFor(url.pathname);
    // Dev server and Azure answer an unknown address with the 404 page
    const target = file ?? join(dist, '404.html');
    response.statusCode = file ? 200 : 404;
    response.setHeader('Content-Type', TYPES[extname(target)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.end(readFileSync(target));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`E2E static server on port ${port} (${instance})`);
});
