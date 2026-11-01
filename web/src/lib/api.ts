import { bakedUrl } from './bakedImages';
import { ELEMENT_NODE, SAFE_URL, TEXT_NODE, parseHtml } from './html';
import { TECHNIK_HELP } from './helpContacts';
import { ApiError } from './apiError';
import { API_BASE, request } from './apiRequest';
import { TIMEOUT_MS } from './apiTimeout';

export { ApiError, SESSION_EXPIRED_MESSAGE } from './apiError';
export { getLastApiFailure, type ApiFailure } from './apiRequest';

/** A JSON body above this many characters is an upload and gets the time limit of a file. */
const LARGE_JSON = 256 * 1024;

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
  { signal, saves = true }: { signal?: AbortSignal; saves?: boolean } = {}
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
    (response) => response.json(),
    saves
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
  const json = body === undefined || isBinary ? undefined : JSON.stringify(body);
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
      body: isBinary ? body : json,
    },
    // Photos and PDFs of a Beleg travel as Base64 in JSON
    isBinary || (json?.length ?? 0) > LARGE_JSON ? TIMEOUT_MS.file : TIMEOUT_MS.write,
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
export async function fetchFile(
  endpoint: string,
  signal?: AbortSignal,
  /** More request headers, e.g. the token of a link. */
  headers?: Record<string, string>
): Promise<ApiFile> {
  return request(endpoint, headers ? { signal, headers } : { signal }, TIMEOUT_MS.file, toApiFile);
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
