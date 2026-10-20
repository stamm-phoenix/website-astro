/** Only the route's static page and loaded assets, never API or authentication responses. */
export const ROUTE_SHELL_CACHE = 'nikolaus-route-shell-v1';
export const ROUTE_SHELL_PATH = '/leitendenbereich/nikolaus-fahrt';
const META = '/leitendenbereich/nikolaus-route-expiry';
const WORKER = '/leitendenbereich/nikolaus-route-sw.js';

/** Prepare the page before promising that an offline reload works. */
export async function saveRouteShell(expiresAt: number): Promise<void> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    throw new Error('Dieser Browser unterstützt kein Neuladen ohne Verbindung.');
  }
  const registration = await navigator.serviceWorker.register(WORKER, {
    scope: '/leitendenbereich/',
  });
  // `ready` also waits for installation on the first visit, before the page is controlled.
  await navigator.serviceWorker.ready;
  await registration.update();
  const cache = await caches.open(ROUTE_SHELL_CACHE);
  try {
    await cache.delete(META);
    const response = await fetch(ROUTE_SHELL_PATH, { cache: 'no-store' });
    if (
      !response.ok ||
      response.redirected ||
      !response.headers.get('content-type')?.includes('text/html')
    ) {
      throw new Error('Die Fahrtansicht konnte nicht gespeichert werden.');
    }
    // The fetched HTML may belong to a newer deployment than the open page.
    const shell = new DOMParser().parseFromString(await response.clone().text(), 'text/html');
    const shellUrl = response.url || new URL(ROUTE_SHELL_PATH, location.href).href;
    await cache.put(ROUTE_SHELL_PATH, response);
    const allowed = (url: URL): boolean =>
      url.origin === location.origin &&
      (url.pathname.startsWith('/_astro/') ||
        (import.meta.env.DEV && /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname)));
    const paths = new Set<string>();
    const pending: string[] = [];
    function include(value: string, base = shellUrl): void {
      const url = new URL(value, base);
      if (!allowed(url) || paths.has(url.href)) return;
      paths.add(url.href);
      pending.push(url.href);
    }
    function imports(source: string, base: string): void {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of code.matchAll(
        /(?:^|[;\n])\s*(?:import|export)\s*(?:[^'";]{0,1000}?\bfrom\s*)?['"]([^'"]+)['"]/g
      ))
        include(match[1], base);
      for (const match of code.matchAll(/(?:^|[^\w$])import\s*\(\s*['"]([^'"]+)['"]/g))
        include(match[1], base);
    }
    // Seed the dependency graph exclusively from the exact HTML cached above.
    for (const node of shell.querySelectorAll('script[src], link[href], astro-island')) {
      for (const attr of ['src', 'href', 'component-url', 'renderer-url']) {
        const value = node.getAttribute(attr);
        if (value) include(value);
      }
    }
    for (const script of shell.querySelectorAll('script:not([src])'))
      imports(script.textContent ?? '', shellUrl);
    if (import.meta.env.DEV) include('/@id/astro:scripts/before-hydration.js');
    while (pending.length) {
      await Promise.all(
        pending.splice(0, 4).map(async (url) => {
          const asset = await fetch(url);
          if (!asset.ok || asset.redirected) throw new Error('Eine Seitendatei fehlt.');
          await cache.put(url, asset.clone());
          const type = asset.headers.get('content-type') ?? '';
          if (/javascript/.test(type)) imports(await asset.text(), url);
          else if (/text\/css/.test(type)) {
            for (const match of (await asset.text()).matchAll(
              /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g
            ))
              include(match[1], url);
          }
        })
      );
    }
    // An incomplete cache is never usable as an offline page.
    await cache.put(META, new Response(String(expiresAt)));
  } catch (error) {
    await caches.delete(ROUTE_SHELL_CACHE);
    throw error;
  }
}

/** Clear the opt-in cache at logout, expiry, authentication denial or explicit removal. */
export async function forgetRouteShell(): Promise<void> {
  if ('caches' in window) await caches.delete(ROUTE_SHELL_CACHE);
}
