/**
 * How the built site in `dist/` answers a request outside `/api/*` and `/.auth/*`: the routes,
 * response overrides, headers and MIME types of `public/staticwebapp.config.json`, read from that
 * file, so the browser tests meet the rewrites and redirects of the Static Web App without a
 * second copy of them. Used by `scripts/serve-built.ts`; pure, so it is unit-tested.
 *
 * Not modelled: `allowedRoles` (the mock login is always signed in, like on the dev server) and
 * `auth`. A route's `statusCode` and the 404 page go through `responseOverrides` like on Azure.
 */
import { posix } from 'node:path';

export interface SwaRoute {
  route: string;
  rewrite?: string;
  redirect?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  allowedRoles?: string[];
}

export interface SwaOverride {
  rewrite?: string;
  redirect?: string;
  statusCode?: number;
}

export interface SwaConfig {
  routes?: SwaRoute[];
  responseOverrides?: Record<string, SwaOverride>;
  globalHeaders?: Record<string, string>;
  mimeTypes?: Record<string, string>;
}

export type BuiltResponse =
  | { kind: 'redirect'; status: number; location: string; headers: Record<string, string> }
  | { kind: 'file'; status: number; file: string; headers: Record<string, string> }
  | { kind: 'empty'; status: number; headers: Record<string, string> };

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

/**
 * The pattern of a route: `*` matches the rest of the path and `{a,b}` one of the listed parts
 * (as in `/*.{png,svg}`); a trailing `/*` also matches the folder itself, so `/a/*` covers
 * `/a`. Azure compares routes without regard to case.
 */
export function routePattern(route: string): RegExp {
  let source = '';
  for (let i = 0; i < route.length; i++) {
    const char = route[i];
    if (char === '/' && i === route.length - 2 && route.endsWith('/*')) {
      source += '(?:/.*)?';
      break;
    }
    if (char === '*') source += '.*';
    else if (char === '{') {
      const end = route.indexOf('}', i);
      if (end < 0) throw new Error(`Unclosed { in route ${route}`);
      source += `(?:${route
        .slice(i + 1, end)
        .split(',')
        .map((part) => escape(part.trim()))
        .join('|')})`;
      i = end;
    } else source += escape(char);
  }
  return new RegExp(`^${source}$`, 'i');
}

function escape(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** The first route that matches the path; a trailing slash is ignored like on Azure. */
export function matchRoute(config: SwaConfig, pathname: string): SwaRoute | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return config.routes?.find((entry) => routePattern(entry.route).test(path));
}

export function contentType(config: SwaConfig, file: string): string {
  const extension = posix.extname(file).toLowerCase();
  return config.mimeTypes?.[extension] ?? MIME_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * The file in `dist/` that answers `pathname` (relative, without a leading slash), or `null`.
 * `/a` and `/a/` find `a/index.html` (Astro's directory format) or `a.html`. Normalizing an
 * absolute path drops `..` at the root, so the file never lies outside `dist/`; a relative
 * path finds nothing.
 */
export function findFile(pathname: string, exists: (file: string) => boolean): string | null {
  const path = posix.normalize(pathname);
  if (!path.startsWith('/')) return null;
  const relative = path.slice(1);
  const candidates =
    relative.endsWith('/') || relative === ''
      ? [`${relative}index.html`]
      : [relative, `${relative}/index.html`, `${relative}.html`];
  return candidates.find((file) => exists(file)) ?? null;
}

/**
 * How the Static Web App would answer a GET of `pathname` for the files that `exists` reports:
 * the first matching route redirects, rewrites or sets a status; a missing file or a status
 * of 400 and above goes through `responseOverrides` (404 → `/404.html` with status 404).
 * Headers are the matching route's plus `globalHeaders`.
 */
export function resolveBuilt(
  config: SwaConfig,
  pathname: string,
  exists: (file: string) => boolean
): BuiltResponse {
  const matched = matchRoute(config, pathname);
  const headers = { ...config.globalHeaders, ...matched?.headers };

  if (matched?.redirect) {
    return {
      kind: 'redirect',
      status: matched.statusCode ?? 302,
      location: matched.redirect,
      headers,
    };
  }
  if (matched?.statusCode && matched.statusCode >= 400) {
    return override(config, matched.statusCode, headers, exists);
  }
  const file = findFile(matched?.rewrite ?? pathname, exists);
  if (!file) return override(config, 404, headers, exists);
  return { kind: 'file', status: matched?.statusCode ?? 200, file, headers };
}

function override(
  config: SwaConfig,
  status: number,
  headers: Record<string, string>,
  exists: (file: string) => boolean
): BuiltResponse {
  const rule = config.responseOverrides?.[String(status)];
  if (rule?.redirect) {
    return {
      kind: 'redirect',
      status: rule.statusCode ?? 302,
      location: rule.redirect,
      headers,
    };
  }
  const file = rule?.rewrite ? findFile(rule.rewrite, exists) : null;
  const code = rule?.statusCode ?? status;
  return file
    ? { kind: 'file', status: code, file, headers }
    : { kind: 'empty', status: code, headers };
}
