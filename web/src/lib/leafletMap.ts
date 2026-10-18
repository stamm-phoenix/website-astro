import type * as Leaflet from 'leaflet';

/** Leaflet and its styles are loaded only when a map is shown. */
export async function loadLeaflet(): Promise<typeof Leaflet> {
  const [module] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
  return module.default;
}

/** Shared map interaction, attribution and privacy settings for address and route maps. */
export function createOsmMap(L: typeof Leaflet, element: HTMLElement): Leaflet.Map {
  const map = L.map(element, { scrollWheelZoom: false, dragging: !L.Browser.mobile });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // Only the origin, never a path containing a booking token, is sent to the tile provider.
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  }).addTo(map);
  return map;
}
