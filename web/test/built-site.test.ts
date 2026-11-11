import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  contentType,
  findFile,
  matchRoute,
  resolveBuilt,
  routePattern,
  type SwaConfig,
} from '../scripts/built-site';

// The real configuration, so a route the server no longer understands fails here
const config = JSON.parse(
  readFileSync(new URL('../public/staticwebapp.config.json', import.meta.url), 'utf8')
) as SwaConfig;

const FILES = new Set([
  'index.html',
  '404.html',
  'gruppenstunden/index.html',
  'impressum.html',
  'leitendenbereich/index.html',
  'leitendenbereich/abrechnung/index.html',
  'leitendenbereich/abrechnung/detail/index.html',
  'leitendenbereich/sammelbestellungen/index.html',
  'leitendenbereich/sammelbestellungen/detail/index.html',
  'leitendenbereich.webmanifest',
  '_astro/app.js',
  'favicon.ico',
]);
const exists = (file: string): boolean => FILES.has(file);
const resolveGet = (path: string) => resolveBuilt(config, path, exists);

describe('routePattern', () => {
  test('a trailing /* covers the folder and everything below it', () => {
    const pattern = routePattern('/leitendenbereich/*');
    assert.ok(pattern.test('/leitendenbereich'));
    assert.ok(pattern.test('/leitendenbereich/belege'));
    assert.ok(!pattern.test('/leitendenbereichx'));
  });

  test('{a,b} matches one of the parts, without regard to case', () => {
    const pattern = routePattern('/*.{png,svg}');
    assert.ok(pattern.test('/logo.svg'));
    assert.ok(pattern.test('/A/B.PNG'));
    assert.ok(!pattern.test('/logo.svgz'));
  });

  test('a dot in a route is no wildcard', () => {
    assert.ok(!routePattern('/content-version.json').test('/content-versionxjson'));
  });

  test('an unclosed brace is an error', () => {
    assert.throws(() => routePattern('/*.{png'), /Unclosed/);
  });
});

describe('resolveBuilt with staticwebapp.config.json', () => {
  test('Abrechnung and Sammelbestellung details are rewritten to their detail page', () => {
    assert.deepEqual(
      [
        '/leitendenbereich/abrechnung/evt_Sola26',
        '/leitendenbereich/sammelbestellungen/12',
        '/leitendenbereich/sammelbestellungen/12/',
      ].map((path) => {
        const answer = resolveGet(path);
        return answer.kind === 'file' ? [answer.status, answer.file] : answer;
      }),
      [
        [200, 'leitendenbereich/abrechnung/detail/index.html'],
        [200, 'leitendenbereich/sammelbestellungen/detail/index.html'],
        [200, 'leitendenbereich/sammelbestellungen/detail/index.html'],
      ]
    );
  });

  test('the overview stays the overview, with and without trailing slash', () => {
    for (const path of ['/leitendenbereich/abrechnung', '/leitendenbereich/abrechnung/']) {
      const answer = resolveGet(path);
      assert.equal(answer.kind === 'file' && answer.file, 'leitendenbereich/abrechnung/index.html');
    }
  });

  test('pages are found in Astro’s directory format and as .html', () => {
    const files = ['/', '/gruppenstunden', '/gruppenstunden/', '/impressum'].map((path) => {
      const answer = resolveGet(path);
      return answer.kind === 'file' ? answer.file : answer.kind;
    });
    assert.deepEqual(files, [
      'index.html',
      'gruppenstunden/index.html',
      'gruppenstunden/index.html',
      'impressum.html',
    ]);
  });

  test('/login and /logout redirect to the login of the Static Web App', () => {
    const login = resolveGet('/login');
    const logout = resolveGet('/logout');
    assert.equal(login.kind, 'redirect');
    assert.equal(login.status, 302);
    assert.equal(
      login.kind === 'redirect' && login.location,
      '/.auth/login/aad?post_login_redirect_uri=/leitendenbereich'
    );
    assert.equal(
      logout.kind === 'redirect' && logout.location,
      '/.auth/logout?post_logout_redirect_uri=/abgemeldet'
    );
  });

  test('a missing page and a blocked login provider answer with the 404 page', () => {
    for (const path of ['/gibt-es-nicht', '/.auth/login/github']) {
      const answer = resolveGet(path);
      assert.equal(answer.status, 404, path);
      assert.equal(answer.kind === 'file' && answer.file, '404.html', path);
    }
  });

  test('dot segments never lead out of dist/', () => {
    const all = (): boolean => true;
    assert.equal(findFile('/../../etc/passwd', all), 'etc/passwd');
    assert.equal(findFile('/a/../../package.json', all), 'package.json');
    assert.equal(findFile('../package.json', all), null);
    assert.equal(resolveGet('/../favicon.ico').status, 200);
  });

  test('headers combine the matching route with the global headers', () => {
    const staff = resolveGet('/leitendenbereich').headers;
    assert.equal(staff['X-Robots-Tag'], 'noindex');
    assert.equal(staff['Cache-Control'], 'no-store');
    assert.equal(staff['X-Frame-Options'], 'DENY');
    assert.equal(
      resolveGet('/_astro/app.js').headers['Cache-Control'],
      'public, max-age=31536000, immutable'
    );
    assert.equal(resolveGet('/FAVICON.ICO').headers['Cache-Control'], 'public, max-age=86400');
  });
});

describe('response overrides and types', () => {
  test('an override can redirect instead of rewriting', () => {
    const custom: SwaConfig = {
      routes: [{ route: '/geheim', statusCode: 401 }],
      responseOverrides: { '401': { redirect: '/login', statusCode: 302 } },
    };
    const answer = resolveBuilt(custom, '/geheim', exists);
    assert.deepEqual(answer, { kind: 'redirect', status: 302, location: '/login', headers: {} });
  });

  test('without an override page the status is answered without a body', () => {
    assert.deepEqual(resolveBuilt({}, '/fehlt', exists), {
      kind: 'empty',
      status: 404,
      headers: {},
    });
  });

  test('the first matching route wins', () => {
    assert.equal(
      matchRoute(config, '/leitendenbereich/abrechnung/evt_1')?.rewrite,
      '/leitendenbereich/abrechnung/detail/index.html'
    );
  });

  test('MIME types of the configuration come before the built-in ones', () => {
    assert.equal(contentType(config, 'leitendenbereich.webmanifest'), 'application/manifest+json');
    assert.equal(contentType(config, '_astro/app.js'), 'text/javascript; charset=utf-8');
    assert.equal(contentType(config, 'datei.unbekannt'), 'application/octet-stream');
  });
});
