<script lang="ts">
  import { loadLeaflet, createMap } from '../lib/leafletMap';
  import type { Map as LeafletMap, LayerGroup } from 'leaflet';
  import { onDestroy } from 'svelte';
  import { postApi } from '../lib/api';
  import type { NikolausAreaConfig } from '../lib/nikolausConfig';
  import {
    distanceKm,
    isOutsideServicePostalCodes,
    isValidNikolausPostalCode,
  } from '../lib/nikolausConfig';
  import type { NikolausGeocodeResult, NikolausLocation } from '../lib/types';

  interface Props {
    street: string;
    postalCode: string;
    city: string;
    /** Stored location of a booking; shows it without looking the address up again. */
    location?: NikolausLocation | null;
    /** Service area from the Steuerung. */
    area: NikolausAreaConfig;
  }

  let { street, postalCode, city, location, area }: Props = $props();

  const DEBOUNCE_MS = 800;
  const base = $derived(area.base);
  const farDistanceKm = $derived(area.farDistanceKm);

  let container = $state<HTMLDivElement | null>(null);
  let lookedUp = $state<NikolausGeocodeResult | null>(null);
  let map: LeafletMap | null = null;
  let layers: LayerGroup | null = null;
  let requestId = 0;

  const readonly = $derived(location !== undefined);
  const complete = $derived(
    street.trim() !== '' && city.trim() !== '' && isValidNikolausPostalCode(postalCode)
  );

  /** What to show: the stored location, or the result of the lookup while typing. */
  const result = $derived.by((): NikolausGeocodeResult | null => {
    if (readonly) {
      return location
        ? {
            found: true,
            precision: location.approximate ? 'area' : 'address',
            lat: location.lat,
            lon: location.lon,
          }
        : null;
    }
    return complete ? lookedUp : null;
  });

  const point = $derived(
    result?.found && result.lat !== undefined && result.lon !== undefined
      ? { lat: result.lat, lon: result.lon }
      : null
  );
  const approximate = $derived(result?.precision === 'area');

  const notFound = $derived(
    !readonly && result !== null && !result.unavailable && (!result.found || approximate)
  );
  const outsideArea = $derived(
    !readonly &&
      isValidNikolausPostalCode(postalCode) &&
      isOutsideServicePostalCodes(postalCode, { area })
  );
  const farAway = $derived(
    !readonly && point !== null && !approximate && distanceKm(base, point) > farDistanceKm
  );

  // Look the address up while typing, debounced; stale answers are ignored.
  $effect(() => {
    if (readonly || !complete) return;
    const address = { street: street.trim(), postalCode: postalCode.trim(), city: city.trim() };
    const current = ++requestId;
    const timer = setTimeout(async () => {
      try {
        const answer = await postApi<NikolausGeocodeResult>('/nikolaus/geocode', address);
        if (current === requestId) lookedUp = answer;
      } catch {
        if (current === requestId) lookedUp = { found: false, unavailable: true };
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (container && point) {
      void render(container, point, approximate);
    }
  });

  async function render(
    element: HTMLDivElement,
    target: { lat: number; lon: number },
    isApproximate: boolean
  ): Promise<void> {
    const L = await loadLeaflet();

    // The container is re-created when the address was incomplete in between
    if (map && map.getContainer() !== element) {
      map.remove();
      map = null;
    }

    if (!map) {
      map = createMap(L, element);
      layers = L.layerGroup().addTo(map);
    }

    const group = layers ?? L.layerGroup().addTo(map);
    layers = group;
    group.clearLayers();
    const from = L.latLng(base.lat, base.lon);
    const to = L.latLng(target.lat, target.lon);

    L.circleMarker(from, {
      radius: 7,
      color: '#003056',
      fillColor: '#003056',
      fillOpacity: 0.9,
      weight: 2,
    })
      .bindTooltip(base.name)
      .addTo(group);

    if (isApproximate) {
      L.circleMarker(to, {
        radius: 10,
        color: '#810a1a',
        fillColor: '#810a1a',
        fillOpacity: 0.25,
        weight: 1,
        dashArray: '4 4',
      })
        .bindTooltip('Ungefähre Lage')
        .addTo(group);
      map.setView(to, 13);
    } else {
      L.polyline([from, to], { color: '#810a1a', weight: 2, opacity: 0.7, dashArray: '6 6' }).addTo(
        group
      );
      L.circleMarker(to, {
        radius: 8,
        color: '#ffffff',
        fillColor: '#810a1a',
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip('Ihre Adresse')
        .addTo(group);
      map.fitBounds(L.latLngBounds([from, to]), { padding: [32, 32], maxZoom: 16 });
    }

    // The container may have been hidden or resized before the map was created
    map.invalidateSize();
  }

  onDestroy(() => {
    map?.remove();
    map = null;
    layers = null;
  });
</script>

{#if !readonly}
  <p class="mt-2 text-xs text-neutral-700">
    Zur Kontrolle zeigen wir Ihre Adresse auf einer Karte an. Dafür wird sie an den Kartendienst
    Microsoft Azure Maps übermittelt.
  </p>
{/if}

{#if point}
  <div
    bind:this={container}
    class="address-map mt-3 overflow-hidden rounded-md border border-[var(--color-brand-200)]"
    role="img"
    aria-label={approximate
      ? 'Karte mit der ungefähren Lage Ihres Ortes'
      : 'Karte mit der Lage Ihrer Adresse'}
  ></div>
{:else if !readonly}
  <!-- Keeps the room of the map, so the form does not jump while the address is typed -->
  <div
    class="address-map mt-3 flex items-center justify-center rounded-md border border-dashed border-[var(--color-brand-200)] p-4 text-center text-sm text-neutral-700"
    role="status"
    aria-live="polite"
  >
    {complete && result === null
      ? 'Adresse wird auf der Karte gesucht …'
      : complete
        ? 'Diese Adresse können wir nicht auf der Karte zeigen.'
        : 'Hier sehen Sie Ihre Adresse auf der Karte, sobald Straße, PLZ und Ort ausgefüllt sind.'}
  </div>
{/if}
{#if point || !readonly}
  <!-- Tooltips need a mouse; on phones the legend is the only explanation. It is there from the
       start and keeps two lines, so the form does not jump when the map appears. -->
  <p class="mt-2 flex min-h-9 flex-wrap content-start gap-x-4 gap-y-1 text-xs text-neutral-700">
    <span class="inline-flex items-center gap-1.5">
      <span class="legend-dot legend-target" aria-hidden="true"></span>
      {approximate ? 'Ungefähre Lage Ihres Ortes' : 'Ihre Adresse'}
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span class="legend-dot legend-base" aria-hidden="true"></span>
      Startpunkt unserer Teams ({base.name})
    </span>
  </p>
{/if}

{#if notFound || outsideArea || farAway}
  <div class="mt-3 space-y-2" role="status">
    {#if notFound}
      <p class="hint">
        <span>
          Wir konnten die genaue Adresse auf der Karte nicht finden. Bitte prüfen Sie die
          Schreibweise – bei neuen Straßen kann die Karte aber auch einfach veraltet sein.
        </span>
      </p>
    {/if}
    {#if outsideArea}
      <p class="hint">
        <span>
          Diese PLZ liegt nach unseren Angaben außerhalb unseres Einzugsgebiets
          (Feldkirchen-Westerham, Bruckmühl und Umgebung). Bitte prüfen Sie, ob Sie wirklich bei uns
          in der Gegend wohnen – die Seite kann sich natürlich auch irren.
        </span>
      </p>
    {/if}
    {#if farAway}
      <p class="hint">
        <span>
          Ihre Adresse liegt etwas weiter von unserem Startpunkt entfernt. Wegen der Anfahrt kann es
          sein, dass wir etwas später kommen und den Besuch ein wenig kürzer halten müssen.
        </span>
      </p>
    {/if}
  </div>
{/if}

<style>
  .address-map {
    background: var(--color-neutral-100);
    height: 220px;
    /* Keep Leaflet's panes below the sticky site header */
    position: relative;
    z-index: 0;
  }
  @media (min-width: 768px) {
    .address-map {
      height: 260px;
    }
  }
  .legend-dot {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 9999px;
    box-shadow: 0 0 0 1px var(--color-brand-200);
  }
  .legend-target {
    background: #810a1a;
  }
  .legend-base {
    background: #003056;
  }
  .hint {
    border-left: 4px solid var(--color-dpsg-woelflinge);
    padding: 0.25rem 0 0.25rem 1rem;
    font-size: 0.875rem;
    color: var(--color-neutral-800);
  }
</style>
