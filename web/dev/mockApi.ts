/**
 * Local mock of the Azure Functions API and the Static Web Apps auth endpoints, so every page
 * renders with realistic test data without a backend: `MOCK_API=1 bun run dev`.
 *
 * Handles `/api/*` and `/.auth/*`; everything else goes to Astro. Writes succeed after a short
 * delay (to make loading states visible) and are kept in memory until the dev server restarts.
 * Unknown API paths answer 404 and are logged, so gaps are easy to spot.
 */
import { mockContentReview } from './mockContentReview';
import { ValidationError } from '../../api/lib/validation/errors';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { error, json, notFound, routes, wait } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { LOGGED_OUT_COOKIE, PRINCIPAL, isLoggedOut, requireLogin, safeRedirect } from './mockAuth';
import './mockPublic';
import './mockNikolaus';
import './mockKontakt';
import './mockProblemmeldung';
import './mockNikolausStaff';
import './mockEssenCommon';
import './mockEssenStaff';
import './mockEssenPlanung';
import './mockEssenGerichte';
import './mockEssenEinkauf';
import './mockAbrechnung';
import './mockProtokolle';
import './mockAufgaben';
import './mockPflegeContent';
import './mockAnwesenheit';
import './mockProtokollEditor';
import './mockStaffPersoenlich';
import './mockBelege';
import './mockDownloads';
import './mockSammel';
import './mockFotos';
import './mockAbstimmungen';

export { mockRouteTable } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Plumbing

/** Delay for reads and writes, so skeletons and busy states can be reviewed. */
const READ_DELAY_MS: [number, number] = [150, 350];
const WRITE_DELAY_MS: [number, number] = [600, 900];

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(raw: Buffer, contentType: string | undefined): Record<string, unknown> | null {
  if (raw.length === 0 || !contentType?.includes('json')) return null;
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, result: MockResult): void {
  res.setHeader('X-Mock-Api', '1');
  if (result.kind === 'redirect') {
    res.statusCode = 302;
    res.setHeader('Location', result.location);
    res.end();
    return;
  }
  res.statusCode = result.status;
  if (result.kind === 'empty') {
    res.end();
    return;
  }
  if (result.kind === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(result.body));
    return;
  }
  res.setHeader('Content-Type', result.contentType);
  for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
  res.end(typeof result.body === 'string' ? result.body : Buffer.from(result.body));
}

function handleAuth(req: MockRequest, res: ServerResponse): void {
  if (req.path === '/.auth/me') {
    send(res, json({ clientPrincipal: isLoggedOut(req) ? null : PRINCIPAL }));
    return;
  }
  if (req.path.startsWith('/.auth/login')) {
    res.setHeader('Set-Cookie', `${LOGGED_OUT_COOKIE}=; Path=/; Max-Age=0`);
    send(res, {
      kind: 'redirect',
      location: safeRedirect(req.query.get('post_login_redirect_uri'), '/leitendenbereich'),
    });
    return;
  }
  if (req.path.startsWith('/.auth/logout')) {
    res.setHeader('Set-Cookie', `${LOGGED_OUT_COOKIE}=1; Path=/`);
    send(res, {
      kind: 'redirect',
      location: safeRedirect(req.query.get('post_logout_redirect_uri'), '/'),
    });
    return;
  }
  send(res, notFound('Unbekannter Auth-Endpunkt (Mock).'));
}

async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const raw = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
  const request: MockRequest = {
    method: (req.method ?? 'GET').toUpperCase(),
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    params: {},
    headers: req.headers,
    raw,
    json: parseJson(raw, req.headers['content-type']),
  };

  if (request.path.startsWith('/.auth/')) {
    handleAuth(request, res);
    return;
  }

  const method = request.method === 'HEAD' ? 'GET' : request.method;
  let pathMatched = false;
  for (const candidate of routes) {
    const match = candidate.pattern.exec(request.path);
    if (!match) continue;
    pathMatched = true;
    if (!candidate.methods.includes(method)) continue;
    candidate.keys.forEach((key, i) => (request.params[key] = decodeURIComponent(match[i + 1])));

    if (!candidate.instant) await wait(method === 'GET' ? READ_DELAY_MS : WRITE_DELAY_MS);
    const denied = request.path.startsWith('/api/intern/') ? requireLogin(request) : null;
    try {
      send(res, denied ?? candidate.handler(request));
    } catch (caught) {
      if (caught instanceof ValidationError)
        send(res, json({ code: 'INVALID', message: caught.message, fields: caught.fields }, 400));
      else throw caught;
    }
    return;
  }

  if (pathMatched) {
    send(res, error(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.'));
    return;
  }
  console.warn(`[mock-api] No mock for ${request.method} ${request.path}`);
  send(res, error(404, 'NOT_FOUND', `Kein Mock für ${request.method} ${request.path}.`));
}

/**
 * Answers a GET like the middleware, without server and delay. The build bakes these answers
 * into the pages when `CONTENT_SOURCE` is `mock` (see `src/lib/content/source.ts`).
 */
export function handleMockGet(pathWithQuery: string): {
  status: number;
  contentType: string;
  body: Uint8Array;
} {
  const url = new URL(pathWithQuery, 'http://localhost');
  const request: MockRequest = {
    method: 'GET',
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    params: {},
    headers: {},
    raw: Buffer.alloc(0),
    json: null,
  };
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  for (const candidate of routes) {
    const match = candidate.pattern.exec(request.path);
    if (!match || !candidate.methods.includes('GET')) continue;
    candidate.keys.forEach((key, i) => (request.params[key] = decodeURIComponent(match[i + 1])));
    const result = candidate.handler(request);
    if (result.kind === 'json') {
      return {
        status: result.status,
        contentType: 'application/json; charset=utf-8',
        body: encode(JSON.stringify(result.body)),
      };
    }
    if (result.kind === 'raw') {
      return {
        status: result.status,
        contentType: result.contentType,
        body: typeof result.body === 'string' ? encode(result.body) : result.body,
      };
    }
    return {
      status: result.kind === 'empty' ? result.status : 302,
      contentType: '',
      body: encode(''),
    };
  }
  return { status: 404, contentType: '', body: encode('') };
}

/** Connect middleware serving the mock API for `/api/*` and `/.auth/*`. */
export function mockApiMiddleware(): Connect.NextHandleFunction {
  console.info('[mock-api] Serving /api/* and /.auth/* with test data (MOCK_API=1).');
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/.auth/')) {
      next();
      return;
    }
    (async () => {
      if (await mockContentReview(req, res, url.pathname)) return;
      await handle(req, res, url);
    })().catch((caught: unknown) => {
      console.error('[mock-api] Handler failed', caught);
      if (!res.headersSent) send(res, error(500, 'MOCK_ERROR', 'Fehler in der Mock-API.'));
      else res.end();
    });
  };
}
