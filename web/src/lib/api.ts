import { bakedUrl } from './bakedImages';
import { ELEMENT_NODE, SAFE_URL, TEXT_NODE, parseHtml } from './html';
import { PERMISSION_HELP, TECHNIK_HELP } from './helpContacts';
import {
  READ_TIMEOUT_MESSAGE,
  TIMEOUT_MS,
  WRITE_TIMEOUT_MESSAGE,
  deadline,
  type Deadline,
} from './apiTimeout';

const API_BASE = '/api';

interface ApiErrorDetails {
  code?: string;
  /** Validation messages per form field, if the API rejected the input. */
  fields?: Record<string, string>;
  /** The server sent no usable message, e.g. a crash (5xx) or an unknown status. */
  unexplained?: boolean;
}

export class ApiError extends Error {
  readonly code?: string;
  readonly fields?: Record<string, string>;
  readonly unexplained: boolean;

  constructor(
    public status: number,
    message: string,
    { code, fields, unexplained = false }: ApiErrorDetails = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.unexplained = unexplained;
  }
}

/** Shown for every request whose login has expired; dialogs offer to log in again next to it. */
export const SESSION_EXPIRED_MESSAGE =
  'Deine Anmeldung ist abgelaufen. Deine Eingaben sind noch da.';

/** Login in a new tab; the page it returns to asks to close that tab and save again. */
export const RELOGIN_URL =
  '/.auth/login/aad?post_login_redirect_uri=/leitendenbereich/wieder-angemeldet';

/**
 * True in the app added to the home screen of an iPhone or iPad. A new tab opens in Safari
 * there, which has its own login, so `RELOGIN_URL` would not log the app in again.
 */
export function reloginOnlyHere(): boolean {
  return (
    typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone === true
  );
}

/** Login that comes back to `path`. */
export function loginUrl(path: string): string {
  return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(path)}`;
}

/** Login in this window that comes back to the current page; its inputs are lost. */
export function reloginHereUrl(): string {
  // The fragment too: the photos keep their view and target folder in it
  return loginUrl(`${location.pathname}${location.search}${location.hash}`);
}

/**
 * The text to show for a failed request. The server's own message wins; without one (a crash,
 * an unknown status, no connection) the caller's `fallback` says what failed and what to do,
 * and a server error adds whom to ask.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  return error.unexplained ? `${fallback} ${TECHNIK_HELP}` : error.message;
}

/**
 * Sends an uncached request and returns the successful response. Errors are thrown as `ApiError`.
 * Internal requests do not follow redirects: the platform redirects them to the Microsoft login
 * once the login has expired, and following that would fail like a lost connection.
 *
 * A request without an answer within `timeoutMs` (until the headers arrive) fails with code
 * `TIMEOUT`; `init.signal` aborts it earlier and rethrows the `AbortError`. A read (GET) is sent
 * once more after a timeout or a lost connection; a write never is, because it may have been
 * saved, and its message tells the user to check first.
 *
 * `consume` reads the answer (`json()`, `blob()`). It runs inside the same attempt: the time
 * limit ends with the headers, but the caller's abort and the retry of a read also cover a
 * connection that breaks while the body is still arriving.
 */
async function request<T>(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const read = (init.method ?? 'GET') === 'GET';
  for (let attempt = 0; ; attempt++) {
    const limit = deadline(timeoutMs, init.signal ?? undefined);
    try {
      const response = await send(endpoint, { ...init, signal: limit.signal }, limit);
      return await consume(response);
    } catch (error: unknown) {
      const lost = limit.timedOut() || (error instanceof TypeError && !init.signal?.aborted);
      if (read && attempt === 0 && lost) continue;
      if (limit.timedOut()) {
        recordFailure(endpoint, 0, 'TIMEOUT', null);
        throw new ApiError(0, read ? READ_TIMEOUT_MESSAGE : WRITE_TIMEOUT_MESSAGE, {
          code: 'TIMEOUT',
        });
      }
      throw error;
    } finally {
      limit.clear();
    }
  }
}

/** One attempt; the time limit ends with the headers of any answer, also an error status. */
async function send(endpoint: string, init: RequestInit, limit: Deadline): Promise<Response> {
  const internal = endpoint.startsWith('/intern/');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...init,
      cache: 'no-store',
      ...(internal ? { redirect: 'manual' } : {}),
    });
  } catch (error: unknown) {
    if (!init.signal?.aborted) recordFailure(endpoint, 0, 'NETWORK', null);
    throw error;
  }
  limit.headersReceived();
  if (internal && response.type === 'opaqueredirect') {
    recordFailure(endpoint, 401, '', response);
    throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  }
  if (!response.ok) {
    const error = await toApiError(response, internal);
    recordFailure(endpoint, response.status, error.code ?? '', response);
    throw error;
  }
  return response;
}

/**
 * The last failed request: what „Problem melden“ adds to a report (`problemMelden.ts`). Only
 * status, code, route without query and a correlation number of the response, never a message
 * or content.
 */
export interface ApiFailure {
  status: number;
  code: string;
  route: string;
  correlationId: string;
  at: number;
}

let lastFailure: ApiFailure | null = null;

function recordFailure(
  endpoint: string,
  status: number,
  code: string,
  response: Response | null
): void {
  // A failing report must not replace the problem it is about
  if (endpoint.startsWith('/problemmeldung')) return;
  lastFailure = {
    status,
    code,
    route: `${API_BASE}${endpoint.split('?')[0]}`,
    // The ID of the request at Cloudflare or Azure, if one answered
    correlationId:
      response?.headers.get('x-ms-request-id') ??
      response?.headers.get('x-request-id') ??
      response?.headers.get('cf-ray') ??
      '',
    at: Date.now(),
  };
}

/** The failed request of the last ten minutes, if any; older ones no longer explain the page. */
export function getLastApiFailure(maxAgeMs = 600_000): ApiFailure | null {
  return lastFailure && Date.now() - lastFailure.at <= maxAgeMs ? lastFailure : null;
}

/** Fetch uncached JSON; `headers` e.g. for a token that must stay out of the URL. */
export async function fetchApi<T>(
  endpoint: string,
  signal?: AbortSignal,
  headers?: Record<string, string>
): Promise<T> {
  return request(endpoint, { signal, headers }, TIMEOUT_MS.read, (response) => response.json());
}

/** Post JSON and return the JSON answer. */
export async function postApi<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  return request(
    endpoint,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    TIMEOUT_MS.write,
    (response) => response.json()
  );
}

/**
 * Sends a request with an optional JSON or binary body. Returns `undefined` for responses
 * without content (204).
 */
export async function sendApi<T = undefined>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: unknown,
  /**
   * `etag`: version of the item as loaded; the API rejects the request if it has changed since.
   * `headers`: more request headers, e.g. the token of a link.
   */
  options: { etag?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<T> {
  const isBinary = body instanceof Blob;
  const headers: Record<string, string> = { ...options.headers };
  if (body !== undefined) {
    headers['Content-Type'] = isBinary
      ? body.type || 'application/octet-stream'
      : 'application/json';
  }
  if (options.etag) headers['If-Match'] = options.etag;
  return request(
    endpoint,
    {
      method,
      signal: options.signal,
      headers,
      body: body === undefined ? undefined : isBinary ? body : JSON.stringify(body),
    },
    isBinary ? TIMEOUT_MS.file : TIMEOUT_MS.write,
    async (response) => (response.status === 204 ? undefined : await response.json()) as T
  );
}

export interface ApiFile {
  blob: Blob;
  /** From `Content-Disposition`, if the API sent one. */
  fileName: string | null;
  headers: Headers;
}

/** Loads a file, e.g. an image; errors are thrown as `ApiError` like for JSON endpoints. */
export async function fetchFile(endpoint: string, signal?: AbortSignal): Promise<ApiFile> {
  return request(endpoint, { signal }, TIMEOUT_MS.file, toApiFile);
}

/** Sends JSON and receives a file, e.g. a document generated from the sent data. */
export async function postForFile(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal
): Promise<ApiFile> {
  return request(
    endpoint,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    TIMEOUT_MS.file,
    toApiFile
  );
}

async function toApiFile(response: Response): Promise<ApiFile> {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  let fileName = plain ?? null;
  if (encoded) {
    try {
      fileName = decodeURIComponent(encoded);
    } catch {
      // Keep the ASCII fallback
    }
  }
  return { blob: await response.blob(), fileName, headers: response.headers };
}

const UMLAUTE: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/**
 * File names in plain ASCII: browsers do not reliably keep umlauts in the `download` attribute
 * (Chromium falls back to „download“).
 */
export function asciiFileName(name: string): string {
  return name
    .replace(/[äöüÄÖÜß]/g, (char) => UMLAUTE[char])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_');
}

/** Saves a blob through a temporary object URL. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = asciiFileName(fileName);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds an ApiError, using `code` and `message` from a JSON error body when available. A 401 of
 * an internal request means the login expired, whatever the body says.
 */
async function toApiError(response: Response, internal: boolean): Promise<ApiError> {
  const { status } = response;
  if (internal && status === 401) return new ApiError(401, SESSION_EXPIRED_MESSAGE);
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const { code, message, fields } = body as {
        code?: unknown;
        message?: unknown;
        fields?: unknown;
      };
      // A server error without a code is an unhandled crash with a technical message
      if (typeof message === 'string' && (status < 500 || typeof code === 'string')) {
        return new ApiError(status, message, {
          code: typeof code === 'string' ? code : undefined,
          fields:
            fields && typeof fields === 'object' ? (fields as Record<string, string>) : undefined,
        });
      }
    }
  } catch {
    // Not a JSON body, fall back to the status text
  }
  if (status === 403) {
    return new ApiError(403, `Du hast für diese Aktion keine Berechtigung. ${PERMISSION_HELP}`);
  }
  if (status === 409 || status === 412) {
    return new ApiError(
      status,
      'Die Daten wurden inzwischen geändert. Bitte lade die aktuelle Fassung.'
    );
  }
  return new ApiError(status, 'Die Anfrage konnte nicht verarbeitet werden.', {
    unexplained: true,
  });
}

/** FAQ answer as stored: the formatting plus links; mirrors `validateQuestionAndAnswer`. */
export function sanitizeFaqAnswer(html: string): string {
  return sanitizeDescription(html, 'stored');
}

/** Photo of a Leitende*r; the copy baked into the page if there is one. */
export function getLeaderImageUrl(id: string): string {
  return bakedUrl(`${API_BASE}/leitende/${id}/image`);
}

/**
 * How `sanitizeDescription` treats links: `none` keeps only their text, `stored` keeps `href`
 * (http(s) or mailto) as the API stores it, `public` adds a fixed `rel` for display.
 */
export type DescriptionLinks = 'none' | 'stored' | 'public';

/**
 * Sanitizes HTML content from SharePoint by:
 * 1. Removing the outer ExternalClass wrapper div
 * 2. Stripping inline styles
 * 3. Removing empty elements
 * 4. Allowing only safe HTML tags; links only with `links` (FAQ answers)
 */
export function sanitizeDescription(html: string, links: DescriptionLinks = 'none'): string {
  if (!html || typeof html !== 'string') return '';

  function hasVisibleText(node: Node): boolean {
    if (node.nodeType === TEXT_NODE) {
      return Boolean(node.textContent?.trim());
    }

    if (node.nodeType !== ELEMENT_NODE) {
      return false;
    }

    return Array.from(node.childNodes).some((child) => hasVisibleText(child));
  }

  // Also works during the build, where there is no browser DOM
  const doc = parseHtml(html);

  // Find the content - skip ExternalClass wrapper if present
  let content = doc.body;
  const externalWrapper = doc.querySelector('[class^="ExternalClass"]');
  if (externalWrapper) {
    content = externalWrapper as HTMLElement;
  }

  // Recursive function to clean nodes
  function cleanNode(node: Node): Node | null {
    if (node.nodeType === TEXT_NODE) {
      // Keep text nodes, trim zero-width spaces
      const text = node.textContent?.replace(/[\u200B-\u200D\uFEFF]/g, '') || '';
      return text ? doc.createTextNode(text) : null;
    }

    if (node.nodeType !== ELEMENT_NODE) {
      return null;
    }

    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();

    // Allowed tags
    const allowedTags = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'div', 'span', 'ul', 'ol', 'li'];

    const allowedLink =
      tagName === 'a' && links !== 'none' && SAFE_URL.test(el.getAttribute('href') ?? '');

    if (!allowedTags.includes(tagName) && !allowedLink) {
      // For disallowed tags, just return their text content
      const text = el.textContent?.trim();
      return text ? doc.createTextNode(text) : null;
    }

    // Create clean element without attributes (removes inline styles)
    const cleanEl = doc.createElement(tagName);
    if (tagName === 'a') {
      cleanEl.setAttribute('href', el.getAttribute('href') ?? '');
      if (links === 'public') cleanEl.setAttribute('rel', 'noopener noreferrer');
    }

    // Process children
    for (const child of Array.from(el.childNodes)) {
      const cleanChild = cleanNode(child);
      if (cleanChild) {
        cleanEl.appendChild(cleanChild);
      }
    }

    // Skip empty elements (except br)
    if (tagName !== 'br' && !cleanEl.textContent?.trim()) {
      return null;
    }

    return cleanEl;
  }

  // Clean and collect content
  const result = doc.createElement('div');
  for (const child of Array.from(content.childNodes)) {
    const cleanChild = cleanNode(child);
    if (cleanChild) {
      result.appendChild(cleanChild);
    }
  }

  if (!hasVisibleText(result)) {
    return '';
  }

  return result.innerHTML;
}
