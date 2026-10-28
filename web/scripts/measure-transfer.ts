/**
 * Measures what the public pages transfer, for the data-saving work of #175 (docs/datenverbrauch.md).
 *
 *   bun run build && bun scripts/measure-transfer.ts --serve dist --label nachher --out nachher.json
 *   bun scripts/measure-transfer.ts --url https://www.stamm-phoenix.de --label live
 *   bun scripts/measure-transfer.ts --compare vorher.json nachher.json
 *
 * Every page is opened in a fresh browser context (cold cache) on a phone and on a desktop
 * viewport, then scrolled to the bottom so lazy images count, then reloaded in the same context
 * (warm cache). Bytes are what the browser reports from the network (headers included, after
 * compression, redirects included); requests answered from the cache count as 0. The median of
 * `--runs` runs is kept, also for the cold total. `--serve <dir>` serves a build locally with
 * Brotli/gzip and the `Cache-Control` of the matching route in the build's
 * staticwebapp.config.json (none without a match), without `/api/*` (answered 404 like the
 * content refresh of a page without a backend). The commit is read from the footer of the
 * measured pages. `--blog <path>` pins the post (default: the first one of the blog page), so
 * two reports compare the same pages. Needs PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or an
 * installed Chromium.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { chromium, devices, type Browser, type CDPSession, type Page } from '@playwright/test';

type ResourceType = 'document' | 'script' | 'style' | 'image' | 'font' | 'data' | 'other';

interface Sample {
  bytes: number;
  requests: number;
  byType: Record<ResourceType, number>;
}

interface Measurement {
  /** After the load event, nothing scrolled */
  load: Sample;
  /** After scrolling to the bottom, lazy images included */
  scrolled: Sample;
  /** Load plus scroll of the same visit, so its median is the median of real totals */
  cold: Sample;
  /** Reload with the cache of the first visit */
  warm: Sample;
  /** Largest Contentful Paint of the first load in ms, and the layout shift of the first visit */
  lcp: number;
  cls: number;
}

interface Report {
  label: string;
  base: string;
  commit: string;
  date: string;
  runs: number;
  results: Record<string, Measurement>;
}

const TYPES: ResourceType[] = ['document', 'script', 'style', 'image', 'font', 'data', 'other'];
const PROFILES = {
  mobile: { ...devices['Pixel 7'] },
  desktop: { viewport: { width: 1536, height: 960 } },
};
const PAGES = ['/', '/gruppenstunden/', '/blog/', '/blog/*', '/nikolaus/'];

function emptySample(): Sample {
  return {
    bytes: 0,
    requests: 0,
    byType: Object.fromEntries(TYPES.map((type) => [type, 0])) as Record<ResourceType, number>,
  };
}

function resourceType(cdpType: string): ResourceType {
  switch (cdpType) {
    case 'Document':
      return 'document';
    case 'Script':
      return 'script';
    case 'Stylesheet':
      return 'style';
    case 'Image':
      return 'image';
    case 'Font':
      return 'font';
    case 'XHR':
    case 'Fetch':
      return 'data';
    default:
      return 'other';
  }
}

/** Collects the bytes of every finished request until `take` is called. */
async function trackTransfer(page: Page): Promise<CDPSession & { take: () => Sample }> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  const types = new Map<string, ResourceType>();
  let sample = emptySample();
  session.on('Network.responseReceived', (event) => {
    types.set(event.requestId, resourceType(event.type));
  });
  // A redirect hop has no loadingFinished of its own; its bytes arrive with the next request
  session.on('Network.requestWillBeSent', (event) => {
    const bytes = event.redirectResponse?.encodedDataLength ?? 0;
    if (bytes <= 0) return;
    sample.bytes += bytes;
    sample.byType[resourceType(event.type ?? 'Other')] += bytes;
    sample.requests++;
  });
  session.on('Network.loadingFinished', (event) => {
    const type = types.get(event.requestId) ?? 'other';
    sample.bytes += event.encodedDataLength;
    sample.byType[type] += event.encodedDataLength;
    if (event.encodedDataLength > 0) sample.requests++;
  });
  return Object.assign(session, {
    take: (): Sample => {
      const taken = sample;
      sample = emptySample();
      return taken;
    },
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight / 2));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await settle(page);
}

async function measurePage(
  browser: Browser,
  profile: keyof typeof PROFILES,
  url: string
): Promise<Measurement> {
  const context = await browser.newContext(PROFILES[profile]);
  try {
    await context.addInitScript(() => {
      const metrics = { lcp: 0, cls: 0 };
      // Layout shifts count in session windows: at most 5 s long, a gap of 1 s ends one; CLS is
      // the largest window
      let windowValue = 0;
      let windowStart = 0;
      let windowEnd = 0;
      Object.assign(window, { __metrics: metrics });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          startTime: number;
          hadRecentInput: boolean;
        }[]) {
          if (entry.hadRecentInput) continue;
          if (
            windowValue &&
            entry.startTime - windowEnd < 1000 &&
            entry.startTime - windowStart < 5000
          ) {
            windowValue += entry.value;
          } else {
            windowValue = entry.value;
            windowStart = entry.startTime;
          }
          windowEnd = entry.startTime;
          metrics.cls = Math.max(metrics.cls, windowValue);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await context.newPage();
    const tracker = await trackTransfer(page);
    await page.goto(url);
    await settle(page);
    const load = tracker.take();
    const lcp = await page.evaluate(
      () => (window as unknown as { __metrics: { lcp: number } }).__metrics.lcp
    );
    await scrollToBottom(page);
    const scrolled = tracker.take();
    // The reload starts the page anew, so the shifts of the first visit are read before it
    const cls = await page.evaluate(
      () => (window as unknown as { __metrics: { cls: number } }).__metrics.cls
    );
    await page.reload();
    await settle(page);
    const warm = tracker.take();
    return { load, scrolled, cold: addSamples(load, scrolled), warm, lcp, cls };
  } finally {
    await context.close();
  }
}

function addSamples(a: Sample, b: Sample): Sample {
  return {
    bytes: a.bytes + b.bytes,
    requests: a.requests + b.requests,
    byType: Object.fromEntries(
      TYPES.map((type) => [type, a.byType[type] + b.byType[type]])
    ) as Record<ResourceType, number>,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianSample(samples: Sample[]): Sample {
  return {
    bytes: median(samples.map((sample) => sample.bytes)),
    requests: median(samples.map((sample) => sample.requests)),
    byType: Object.fromEntries(
      TYPES.map((type) => [type, median(samples.map((sample) => sample.byType[type]))])
    ) as Record<ResourceType, number>,
  };
}

function medianMeasurement(runs: Measurement[]): Measurement {
  return {
    load: medianSample(runs.map((run) => run.load)),
    scrolled: medianSample(runs.map((run) => run.scrolled)),
    cold: medianSample(runs.map((run) => run.cold)),
    warm: medianSample(runs.map((run) => run.warm)),
    lcp: Math.round(median(runs.map((run) => run.lcp))),
    cls: Math.round(median(runs.map((run) => run.cls)) * 1000) / 1000,
  };
}

// --- Local server -------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.xml', '.webmanifest']);

interface RouteRule {
  route: string;
  headers?: Record<string, string>;
}

/** The pattern of a route of staticwebapp.config.json: `*` is any text, `{a,b}` a choice. */
function routePattern(route: string): RegExp {
  const source = route
    .replace(/[.+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]*)\}/g, (_match, choices: string) => `(${choices.split(',').join('|')})`)
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}

/** The `Cache-Control` of the first route that matches, like the Static Web App picks it. */
function cacheControl(
  rules: { pattern: RegExp; headers?: Record<string, string> }[],
  pathname: string
) {
  return rules.find((rule) => rule.pattern.test(pathname))?.headers?.['Cache-Control'];
}

function serveDirectory(directory: string): Promise<{ server: Server; base: string }> {
  const root = path.resolve(directory);
  const configFile = path.join(root, 'staticwebapp.config.json');
  const rules = (
    existsSync(configFile)
      ? ((JSON.parse(readFileSync(configFile, 'utf8')) as { routes?: RouteRule[] }).routes ?? [])
      : []
  ).map((rule) => ({ pattern: routePattern(rule.route), headers: rule.headers }));
  const cache = new Map<string, { body: Buffer; encoding?: string }>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let file: string;
    try {
      file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const relative = path.relative(root, file);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      url.pathname.startsWith('/api/')
    ) {
      response.writeHead(404).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const extension = path.extname(file);
    const accepted = String(request.headers['accept-encoding'] ?? '');
    const encoding = !COMPRESSIBLE.has(extension)
      ? undefined
      : accepted.includes('br')
        ? 'br'
        : accepted.includes('gzip')
          ? 'gzip'
          : undefined;
    const key = `${file}|${encoding ?? ''}`;
    let entry = cache.get(key);
    if (!entry) {
      const raw = readFileSync(file);
      const body =
        encoding === 'br'
          ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
          : encoding === 'gzip'
            ? gzipSync(raw)
            : raw;
      entry = { body, encoding };
      cache.set(key, entry);
    }
    const control = cacheControl(rules, url.pathname);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': entry.body.length,
      ...(control ? { 'Cache-Control': control } : {}),
      Vary: 'Accept-Encoding',
      ...(entry.encoding ? { 'Content-Encoding': entry.encoding } : {}),
    });
    response.end(entry.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

// --- Report -------------------------------------------------------------------------------

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const percent = (before: number, after: number): string =>
  before === 0 ? '–' : `${(((after - before) / before) * 100).toFixed(1)} %`;

function compare(beforeFile: string, afterFile: string): string {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8')) as Report;
  const after = JSON.parse(readFileSync(afterFile, 'utf8')) as Report;
  const lines = [
    `Vorher: ${before.label} (${before.commit}, ${before.date}); nachher: ${after.label} (${after.commit}, ${after.date}); Median aus ${after.runs} Läufen.`,
    '',
    '| Seite | Gerät | Kalt (nach Scrollen) vorher | nachher | Änderung | Warm vorher | nachher | LCP ms vorher → nachher | CLS vorher → nachher |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  let totalBefore = 0;
  let totalAfter = 0;
  const onlyBefore = Object.keys(before.results).filter((key) => !(key in after.results));
  const onlyAfter = Object.keys(after.results).filter((key) => !(key in before.results));
  for (const [key, a] of Object.entries(after.results)) {
    const b = before.results[key];
    if (!b) continue;
    const [profile, page] = key.split(' ');
    const coldBefore = b.cold.bytes;
    const coldAfter = a.cold.bytes;
    totalBefore += coldBefore;
    totalAfter += coldAfter;
    lines.push(
      `| ${page} | ${profile} | ${kb(coldBefore)} | ${kb(coldAfter)} | ${percent(coldBefore, coldAfter)} | ${kb(b.warm.bytes)} | ${kb(a.warm.bytes)} | ${b.lcp} → ${a.lcp} | ${b.cls} → ${a.cls} |`
    );
  }
  lines.push(
    '',
    `Summe kalt: ${kb(totalBefore)} → ${kb(totalAfter)} (${percent(totalBefore, totalAfter)}).`
  );
  if (onlyBefore.length + onlyAfter.length > 0) {
    lines.push(
      '',
      `Nicht verglichen, weil nur ein Bericht sie enthält: ${[...onlyBefore, ...onlyAfter].join(', ')}. Mit --blog denselben Beitrag festlegen.`
    );
  }
  return lines.join('\n');
}

function describe(report: Report): string {
  const lines = [
    '| Seite | Gerät | Kalt | davon Bilder | Schrift | Skripte | Requests | Warm | LCP ms | CLS |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [key, m] of Object.entries(report.results)) {
    const [profile, page] = key.split(' ');
    const cold = m.cold.bytes;
    const type = (name: ResourceType): number => m.cold.byType[name];
    lines.push(
      `| ${page} | ${profile} | ${kb(cold)} | ${kb(type('image'))} | ${kb(type('font'))} | ${kb(type('script'))} | ${m.cold.requests} | ${kb(m.warm.bytes)} | ${m.lcp} | ${m.cls} |`
    );
  }
  return lines.join('\n');
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const compareIndex = process.argv.indexOf('--compare');
  if (compareIndex >= 0) {
    console.log(compare(process.argv[compareIndex + 1], process.argv[compareIndex + 2]));
    return;
  }
  const directory = option('serve');
  const served = directory ? await serveDirectory(path.resolve(directory)) : undefined;
  const base = served?.base ?? option('url');
  if (!base) {
    console.error(
      'Usage: --serve <dist directory> | --url <address> [--label x] [--out file] [--runs 3]'
    );
    process.exit(1);
  }
  const runs = Number(option('runs') ?? 3);
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}
  );
  try {
    // `/blog/*` stands for the pinned post, else the first one linked on the blog page
    const probe = await browser.newPage();
    await probe.goto(`${base}/blog/`);
    const post =
      option('blog') ??
      (await probe
        .locator('a[href^="/blog/"]:not([href="/blog/"])')
        .first()
        .getAttribute('href')
        .catch(() => null));
    // The footer links the commit the measured build was made from
    const buildTitle = await probe
      .locator('a[title^="Build "]')
      .first()
      .getAttribute('title')
      .catch(() => null);
    await probe.close();
    const pages = PAGES.flatMap((page) => (page === '/blog/*' ? (post ? [post] : []) : [page]));
    const results: Record<string, Measurement> = {};
    for (const profile of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) {
      for (const page of pages) {
        const samples: Measurement[] = [];
        for (let run = 0; run < runs; run++) {
          samples.push(await measurePage(browser, profile, `${base}${page}`));
        }
        results[`${profile} ${page}`] = medianMeasurement(samples);
        console.error(`${profile} ${page}`);
      }
    }
    const commit = buildTitle?.match(/^Build ([0-9a-f]{7,40})/)?.[1]?.slice(0, 8) ?? 'unbekannt';
    const report: Report = {
      label: option('label') ?? 'messung',
      base: served ? 'lokal (dist)' : base,
      commit,
      date: new Date().toISOString().slice(0, 10),
      runs,
      results,
    };
    const out = option('out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(describe(report));
  } finally {
    await browser.close();
    served?.server.close();
  }
}

await main();
