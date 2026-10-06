import type { HttpRequest } from '@azure/functions';

/** Public address of the production site, used when a request names no known host. */
export const PRODUCTION_SITE_URL = 'https://www.stamm-phoenix.de';

/**
 * Hosts that may appear in links sent by mail: the custom domain, the default and preview
 * hosts of our Static Web App (e.g. `zealous-water-04f606303-94.westeurope.6.azurestaticapps.net`)
 * and local development. Other hosts are ignored so that a forged Host header cannot put a
 * foreign domain into a mail that carries a private token.
 */
const ALLOWED_HOSTS = [
  /^(www\.)?stamm-phoenix\.de$/,
  /^zealous-water-04f606303(-[a-z0-9-]+)?(\.[a-z0-9-]+)*\.azurestaticapps\.net$/,
];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Turns a header value or URL into a site origin if it names an allowed host. */
function allowedOrigin(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return undefined;
  }
  if (LOCAL_HOSTS.includes(url.hostname)) return `http://${url.host}`;
  if (url.port || !ALLOWED_HOSTS.some((host) => host.test(url.hostname))) return undefined;
  return `https://${url.hostname}`;
}

/**
 * Returns the origin of the site the request was sent to, so that mail links point to the
 * environment that sent them (production, a pull request preview or local development).
 * Static Web Apps passes the public address in `x-ms-original-url` and `x-forwarded-host`.
 */
export function getSiteUrl(request: HttpRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  return (
    allowedOrigin(request.headers.get('x-ms-original-url')) ??
    allowedOrigin(forwardedHost) ??
    allowedOrigin(request.url) ??
    PRODUCTION_SITE_URL
  );
}
