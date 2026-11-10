/**
 * Opens the pages a shard is about to test, and the modules they load, once on every mock dev
 * server before the first test starts.
 *
 * The dev server compiles a page and each of its modules when it is first asked for. That cost
 * fell on the first test of a worker that opened the page: long Essensplanung tests used up 10 to
 * 20 seconds of their 30 on it and failed at the first attempt (and passed on the retry). Doing it
 * here moves it out of the test's time. Nothing is skipped and no limit is raised: a page that
 * cannot be opened, or a module that does not answer, is left for the test to report.
 */

const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const HTML_MODULE_URL =
  /(?:component-url|renderer-url|before-hydration-url|src|href)="([^"]+\.(?:js|svelte|ts)[^"]*|\/@vite\/client)"/g;

async function fetchText(url: string, until: number): Promise<string | null> {
  const left = until - Date.now();
  if (left <= 0) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(left) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function resolveUrl(specifier: string, base: string): string | null {
  try {
    return new URL(specifier, base).href;
  } catch {
    return null;
  }
}

/**
 * Fetches `paths` and every module they import, from one server. It stops at `limitMs` for good:
 * every request is cut off at that moment, so the caller can rely on the time it gave.
 */
export async function warmUp(
  origin: string,
  paths: string[],
  { limitMs = 45_000, parallel = 6 } = {}
): Promise<{ pages: number; modules: number; seconds: number }> {
  const started = Date.now();
  const until = started + limitMs;
  const seen = new Set<string>();
  const queue: { url: string; page: boolean }[] = [];
  const add = (url: string | null, page: boolean): void => {
    if (url !== null && !seen.has(url)) {
      seen.add(url);
      queue.push({ url, page });
    }
  };
  for (const path of paths) add(resolveUrl(path, origin), true);
  let pages = 0;
  let modules = 0;
  let busy = 0;
  const worker = async (): Promise<void> => {
    while (Date.now() < until) {
      const item = queue.shift();
      if (item === undefined) {
        // Another worker may still find imports; stop only when all are idle
        if (busy === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      busy++;
      try {
        const body = await fetchText(item.url, until);
        if (body === null) continue;
        if (item.page) {
          pages++;
          for (const match of body.matchAll(HTML_MODULE_URL))
            add(resolveUrl(match[1], origin), false);
        } else {
          modules++;
          if (new URL(item.url).pathname.endsWith('.css')) continue;
          for (const match of body.matchAll(MODULE_SPECIFIER)) {
            const specifier = match[1];
            if (specifier.startsWith('/') || specifier.startsWith('.')) {
              add(resolveUrl(specifier, item.url), false);
            }
          }
        }
      } finally {
        busy--;
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return { pages, modules, seconds: (Date.now() - started) / 1000 };
}
