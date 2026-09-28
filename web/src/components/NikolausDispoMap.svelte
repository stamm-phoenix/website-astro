<script lang="ts" module>
  export interface DispoMapRoute {
    team: string;
    color: string;
    stops: { lat: number; lon: number; label: string }[];
  }
</script>

<script lang="ts">
  import type { Map as LeafletMap, LayerGroup } from 'leaflet';
  import { onDestroy } from 'svelte';
  import { NIKOLAUS_CONFIG } from '../lib/nikolausConfig';

  interface Props {
    routes: DispoMapRoute[];
  }

  let { routes }: Props = $props();

  const { base } = NIKOLAUS_CONFIG.area;

  let container = $state<HTMLDivElement | null>(null);
  let leaflet = $state.raw<typeof import('leaflet') | null>(null);
  let map: LeafletMap | null = null;
  let layers: LayerGroup | null = null;

  $effect(() => {
    void Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([module]) => {
      leaflet = module.default;
    });
  });

  // Drawing is synchronous once Leaflet is loaded, so quick changes cannot overlap
  $effect(() => {
    const current = $state.snapshot(routes) as DispoMapRoute[];
    if (container && leaflet) render(leaflet, container, current);
  });

  function render(
    L: typeof import('leaflet'),
    element: HTMLDivElement,
    current: DispoMapRoute[]
  ): void {
    if (!map) {
      map = L.map(element, { scrollWheelZoom: false, dragging: !L.Browser.mobile });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
      }).addTo(map);
      layers = L.layerGroup().addTo(map);
    }
    const group = layers ?? L.layerGroup().addTo(map);
    layers = group;
    group.clearLayers();

    const home = L.latLng(base.lat, base.lon);
    const bounds = L.latLngBounds([home]);

    for (const route of current) {
      if (route.stops.length === 0) continue;
      const points = route.stops.map((stop) => L.latLng(stop.lat, stop.lon));
      L.polyline([home, ...points, home], {
        color: route.color,
        weight: 3,
        opacity: 0.8,
      }).addTo(group);
      route.stops.forEach((stop, i) => {
        const icon = L.divIcon({
          className: '',
          html: `<span class="dispo-marker" style="background:${route.color}">${i + 1}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker(points[i], { icon, keyboard: false })
          .bindTooltip(`Team ${route.team} · ${i + 1}. ${stop.label}`)
          .addTo(group);
        bounds.extend(points[i]);
      });
    }

    L.circleMarker(home, {
      radius: 8,
      color: '#ffffff',
      fillColor: '#003056',
      fillOpacity: 1,
      weight: 2,
    })
      .bindTooltip(base.name)
      .addTo(group);

    // The container may have changed size since the map was created
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
  }

  onDestroy(() => {
    map?.remove();
    map = null;
    layers = null;
  });
</script>

<div
  bind:this={container}
  class="dispo-map overflow-hidden rounded-md border border-[var(--color-brand-200)]"
  role="img"
  aria-label="Karte mit den Routen aller Teams"
></div>

<style>
  .dispo-map {
    height: 320px;
    /* Keep Leaflet's panes below the sticky site header */
    position: relative;
    z-index: 0;
  }
  @media (min-width: 768px) {
    .dispo-map {
      height: 440px;
    }
  }
  :global(.dispo-marker) {
    display: flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    border-radius: 9999px;
    color: white;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
  }
</style>
