/* An opt-in offline shell for one route. Family data stays in the owner-bound snapshot. */
const CACHE = 'nikolaus-route-shell-v1';
const PAGE = '/leitendenbereich/nikolaus-fahrt';
const META = '/leitendenbereich/nikolaus-route-expiry';

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function savedResponse(request, navigation) {
  const cache = await caches.open(CACHE);
  const meta = await cache.match(META);
  const expiry = Number(meta ? await meta.text() : 0);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    await caches.delete(CACHE);
    return undefined;
  }
  return cache.match(navigation ? PAGE : request, { ignoreVary: true });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate';
  if (navigation && url.pathname.replace(/\/$/, '') !== PAGE) return;
  // No API requests, auth responses, other pages, images or documents are intercepted.
  if (!navigation && !/^\/(?:_astro|src|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (navigation && (response.status === 401 || response.status === 403 || response.redirected)) {
        await caches.delete(CACHE);
      }
      return response;
    } catch (error) {
      const saved = await savedResponse(request, navigation);
      if (saved) return saved;
      throw error;
    }
  })());
});
