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

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/** Fetches `paths` and every module they import, from one server; gives up after `limitMs`. */
export async function warmUp(
  origin: string,
  paths: string[],
  { limitMs = 45_000, parallel = 6 } = {}
): Promise<{ pages: number; modules: number; seconds: number }> {
  const started = Date.now();
  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (url: string): void => {
    if (!seen.has(url)) {
      seen.add(url);
      queue.push(url);
    }
  };
  let pages = 0;
  for (const path of paths) {
    const html = await fetchText(`${origin}${path}`);
    if (html === null) continue;
    pages++;
    for (const match of html.matchAll(HTML_MODULE_URL)) add(new URL(match[1], origin).href);
  }
  let modules = 0;
  const worker = async (): Promise<void> => {
    while (Date.now() - started < limitMs) {
      const url = queue.pop();
      if (url === undefined) return;
      const body = await fetchText(url);
      if (body === null) continue;
      modules++;
      if (new URL(url).pathname.endsWith('.css')) continue;
      for (const match of body.matchAll(MODULE_SPECIFIER)) {
        const specifier = match[1];
        if (specifier.startsWith('/') || specifier.startsWith('.'))
          add(new URL(specifier, url).href);
      }
    }
  };
  // An import that is handled while another worker idles would be missed, so repeat while work is left
  while (queue.length > 0 && Date.now() - started < limitMs) {
    await Promise.all(Array.from({ length: parallel }, worker));
  }
  return { pages, modules, seconds: (Date.now() - started) / 1000 };
}
