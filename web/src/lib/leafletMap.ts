import type * as Leaflet from 'leaflet';

/** Leaflet and its styles are loaded only when a map is shown. */
export async function loadLeaflet(): Promise<typeof Leaflet> {
  const [module] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  return module.default;
}

/** Whether the website shows its dark theme, chosen or from the operating system. */
function isDark(): boolean {
  const choice = document.documentElement.dataset.theme;
  return (
    choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  );
}

function tileStyle(): 'hell' | 'dunkel' {
  return isDark() ? 'dunkel' : 'hell';
}

/** Our API serves the tiles from Azure Maps, so the browser contacts no other service (#408). */
function tileUrl(): string {
  return `/api/karte/${tileStyle()}/{z}/{x}/{y}.png`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
  );
}

/** The copyright notices Azure Maps requires for the tiles of a zoom level, as plain text. */
async function loadAttribution(style: string, zoom: number): Promise<string[]> {
  try {
    const response = await fetch(`/api/karte-quelle/${style}/${zoom}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { copyrights?: unknown };
    return Array.isArray(body.copyrights)
      ? body.copyrights.filter((text): text is string => typeof text === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Shared map interaction and attribution for address and route maps. The tiles follow the
 * theme of the website, also when it is switched while the map is open.
 */
export function createMap(L: typeof Leaflet, element: HTMLElement): Leaflet.Map {
  const map = L.map(element, { scrollWheelZoom: false, dragging: !L.Browser.mobile });
  let url = tileUrl();
  const layer = L.tileLayer(url, { maxZoom: 19, attribution: '&copy; Microsoft' }).addTo(map);

  // The notices depend on the zoom level and the style; the newest request wins
  let notices: string[] = [];
  let shown = '';
  async function updateAttribution(): Promise<void> {
    const key = `${tileStyle()}/${Math.round(map.getZoom())}`;
    if (key === shown) return;
    shown = key;
    const texts = (await loadAttribution(tileStyle(), Math.round(map.getZoom()))).map(escapeHtml);
    if (shown !== key) return;
    for (const text of notices) map.attributionControl.removeAttribution(text);
    for (const text of texts) map.attributionControl.addAttribution(text);
    notices = texts;
  }
  map.on('zoomend', () => void updateAttribution());
  map.whenReady(() => void updateAttribution());

  const update = (): void => {
    if (tileUrl() === url) return;
    url = tileUrl();
    layer.setUrl(url);
    void updateAttribution();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const preference = matchMedia('(prefers-color-scheme: dark)');
  preference.addEventListener('change', update);
  map.on('unload', () => {
    observer.disconnect();
    preference.removeEventListener('change', update);
  });
  return map;
}
