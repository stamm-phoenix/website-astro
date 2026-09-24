<script lang="ts">
  import type { Map as LeafletMap, LayerGroup } from 'leaflet';
  import { onDestroy } from 'svelte';
  import { postApi } from '../lib/api';
  import {
    NIKOLAUS_CONFIG,
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
  }

  let { street, postalCode, city, location }: Props = $props();

  const DEBOUNCE_MS = 800;
  const { base, farDistanceKm } = NIKOLAUS_CONFIG.area;

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
    !readonly && isValidNikolausPostalCode(postalCode) && isOutsideServicePostalCodes(postalCode)
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
    const L = (await import('leaflet')).default;
    await import('leaflet/dist/leaflet.css');

    // The container is re-created when the address was incomplete in between
    if (map && map.getContainer() !== element) {
      map.remove();
      map = null;
    }

    if (!map) {
      map = L.map(element, {
        scrollWheelZoom: false,
        // On touch devices dragging would get in the way of scrolling the page
        dragging: !L.Browser.mobile,
        attributionControl: true,
      });
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
    Zur Kontrolle zeigen wir Ihre Adresse auf einer Karte an. Dafür wird sie an OpenStreetMap
    übermittelt.
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
{/if}

{#if notFound || outsideArea || farAway}
  <div class="mt-3 space-y-2" role="status">
    {#if notFound}
      <p class="hint">
        <span aria-hidden="true">🔎</span>
        <span>
          Wir konnten die genaue Adresse auf der Karte nicht finden. Bitte prüfen Sie die
          Schreibweise – bei neuen Straßen kann die Karte aber auch einfach veraltet sein.
        </span>
      </p>
    {/if}
    {#if outsideArea}
      <p class="hint">
        <span aria-hidden="true">📍</span>
        <span>
          Diese PLZ liegt nach unseren Angaben außerhalb unseres Einzugsgebiets
          (Feldkirchen-Westerham, Bruckmühl und Umgebung). Bitte prüfen Sie, ob Sie wirklich bei uns
          in der Gegend wohnen – die Seite kann sich natürlich auch irren.
        </span>
      </p>
    {/if}
    {#if farAway}
      <p class="hint">
        <span aria-hidden="true">🚗</span>
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
  .hint {
    display: flex;
    gap: 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--color-dpsg-woelflinge) 40%, transparent);
    background: color-mix(in srgb, var(--color-dpsg-woelflinge) 8%, white);
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    color: var(--color-neutral-800);
  }
</style>
