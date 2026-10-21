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

export type TileStyle = 'hell' | 'dunkel';

/** Event that makes a map ask its `style` again, e.g. after a switch next to the map. */
export const TILE_STYLE_CHANGE = 'tilestylechange';

/** Tiles that fit the theme of the website. */
export function themeStyle(): TileStyle {
  return isDark() ? 'dunkel' : 'hell';
}

/** Our API serves the tiles from Azure Maps, so the browser contacts no other service (#408). */
function tileUrl(style: TileStyle): string {
  return `/api/karte/${style}/{z}/{x}/{y}.png`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
  );
}

/** Requests of the copyright notice of one zoom level, with a growing pause in between. */
const ATTRIBUTION_ATTEMPTS = 4;
const ATTRIBUTION_RETRY_MS = 5000;

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
 *
 * A map inside a page lets the page scroll past it; a map that is the main part of the page
 * (`main`) zooms with the mouse wheel and can be moved with one finger.
 */
export function createMap(
  L: typeof Leaflet,
  element: HTMLElement,
  {
    main = false,
    style,
  }: {
    main?: boolean;
    /** Tiles chosen next to the map; `null` follows the theme of the website. */
    style?: () => TileStyle | null;
  } = {}
): Leaflet.Map {
  const tileStyle = (): TileStyle => style?.() ?? themeStyle();
  const map = L.map(element, {
    scrollWheelZoom: main,
    dragging: main || !L.Browser.mobile,
  });
  let url = tileUrl(tileStyle());
  const layer = L.tileLayer(url, { maxZoom: 19, attribution: '&copy; Microsoft' }).addTo(map);

  // The notices depend on the zoom level and the style; the newest request wins. Only notices
  // that arrived count as shown; a failed request is asked again a few times.
  let notices: string[] = [];
  let shown = '';
  let loading = '';
  let attempts = { key: '', count: 0 };
  let retry: ReturnType<typeof setTimeout> | undefined;
  const currentKey = (): string => `${tileStyle()}/${Math.round(map.getZoom())}`;
  async function updateAttribution(): Promise<void> {
    const style = tileStyle();
    const zoom = Math.round(map.getZoom());
    const key = `${style}/${zoom}`;
    if (key === loading) return;
    clearTimeout(retry);
    if (key === shown) {
      // Back at the shown level: a request for another level must not replace its notices
      loading = '';
      return;
    }
    loading = key;
    const texts = (await loadAttribution(style, zoom)).map(escapeHtml);
    if (loading !== key || currentKey() !== key) return;
    loading = '';
    if (texts.length === 0) {
      attempts = { key, count: attempts.key === key ? attempts.count + 1 : 1 };
      if (attempts.count < ATTRIBUTION_ATTEMPTS) {
        retry = setTimeout(() => void updateAttribution(), ATTRIBUTION_RETRY_MS * attempts.count);
      }
      return;
    }
    for (const text of notices) map.attributionControl.removeAttribution(text);
    for (const text of texts) map.attributionControl.addAttribution(text);
    notices = texts;
    shown = key;
  }
  map.on('zoomend', () => void updateAttribution());
  map.whenReady(() => void updateAttribution());

  const update = (): void => {
    if (tileUrl(tileStyle()) === url) return;
    url = tileUrl(tileStyle());
    layer.setUrl(url);
    void updateAttribution();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const preference = matchMedia('(prefers-color-scheme: dark)');
  preference.addEventListener('change', update);
  map.on(TILE_STYLE_CHANGE, update);
  map.on('unload', () => {
    // A request still on its way must neither show its notices nor ask again
    loading = '';
    clearTimeout(retry);
    observer.disconnect();
    preference.removeEventListener('change', update);
  });
  return map;
}
