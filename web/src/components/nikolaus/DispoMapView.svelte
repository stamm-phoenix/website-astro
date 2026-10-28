<script lang="ts" module>
  import type { TileStyle } from '../../lib/leafletMap';

  /** Tiles chosen for the large map; kept while switching between list and map. */
  let chosenStyle = $state<TileStyle | null>(null);
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { CircleMarker, LayerGroup, Map as LeafletMap, Marker, Polyline } from 'leaflet';
  import PinToggle from './PinToggle.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { TILE_STYLE_CHANGE, createMap, loadLeaflet, themeStyle } from '../../lib/leafletMap';
  import { minutesToTime } from '../../lib/nikolausDispo';
  import { legSummary, teamKmLabel } from '../../lib/nikolausDispoMap';
  import type { DispoMapLeg, DispoMapStop, DispoMapTeam } from '../../lib/nikolausDispoMap';
  import { slotLabel } from '../../lib/nikolausMaps';
  import type { NikolausAreaConfig } from '../../lib/nikolausConfig';

  interface Props {
    teams: DispoMapTeam[];
    /** All teams of the day, for moving a visit. */
    options: { name: string; color: string }[];
    base: NikolausAreaConfig['base'];
    /** Visit to show first, e.g. when coming from the list. */
    focus?: string | null;
    onteam: (id: string, team: string) => void;
    onpin: (id: string, team: string) => void;
    /** Switches to the list and shows the visit there. */
    onlist: (id: string) => void;
  }
  let { teams, options, base, focus = null, onteam, onpin, onlist }: Props = $props();

  const NOTABLE_LATE_IN_SLOT = 10;

  /** Teams shown on the map; all of them at the start. */
  let hidden = $state<string[]>([]);
  let selectedId = $state<string | null>(null);
  /** Team pointed at in the legend or the list; the other routes fade. */
  let highlight = $state<string | null>(null);
  /** Drive pointed at on the map; its two ends stand out on the map and in the panel. */
  let pointedLeg = $state<{ team: string; fromId: string | null; toId: string | null } | null>(
    null
  );
  const legEnds = $derived(
    pointedLeg ? [pointedLeg.fromId, pointedLeg.toId].filter((id) => id !== null) : []
  );
  let large = $state(false);

  const shown = $derived(teams.filter((team) => !hidden.includes(team.name)));
  const allStops = $derived(teams.flatMap((team) => team.stops));
  const selected = $derived(allStops.find((stop) => stop.id === selectedId) ?? null);
  const late = $derived(
    shown.flatMap((team) => team.stops).filter((stop) => stop.lateAfterSlot > 0)
  );
  const unlocated = $derived(
    shown.flatMap((team) => team.unlocated.map((booking) => ({ booking, team: team.name })))
  );

  let container = $state<HTMLDivElement | null>(null);
  let leaflet = $state.raw<typeof import('leaflet') | null>(null);
  let map: LeafletMap | null = null;
  let layers: LayerGroup | null = null;
  /** Markers of the visits by booking ID; drawn anew with the map, so not reactive. */
  let markers: Record<string, { marker: Marker; element: HTMLElement; team: string }> = {};
  let lines: { team: string; line: Polyline; leg: DispoMapLeg }[] = [];
  let baseMarker: CircleMarker | null = null;
  /** Teams the map was last fitted to; the view only jumps when they change. */
  let fittedTo: string | null = null;
  /** Road courses the map was last fitted to; they arrive after the first drawing. */
  let fittedRoads: string | null = null;
  /** Set once the person moves or zooms the map; late courses must not move it then. */
  let moved = false;

  /** Tiles of the website's theme, shown while nothing was chosen. */
  let siteStyle = $state<TileStyle>(themeStyle());
  const mapStyle = $derived(chosenStyle ?? siteStyle);

  function chooseStyle(style: TileStyle): void {
    chosenStyle = style;
    map?.fire(TILE_STYLE_CHANGE);
  }

  onMount(() => {
    const follow = (): void => {
      siteStyle = themeStyle();
    };
    const observer = new MutationObserver(follow);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const preference = matchMedia('(prefers-color-scheme: dark)');
    preference.addEventListener('change', follow);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', follow);
    };
  });

  onMount(() => {
    let active = true;
    void loadLeaflet().then((module) => {
      if (active) leaflet = module;
    });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    const current = $state.snapshot(shown) as DispoMapTeam[];
    if (container && leaflet) {
      render(leaflet, container, current);
      // Choosing or pointing at a visit only restyles the drawn markers
      untrack(applyStyles);
    }
  });

  $effect(() => {
    void highlight;
    void selectedId;
    void pointedLeg;
    applyStyles();
  });

  // Coming from the list: show that visit once the map is drawn
  let focused: string | null = null;
  $effect(() => {
    if (focus && focus !== focused && leaflet && container && markers[focus]) {
      focused = focus;
      select(focus);
    }
  });

  function line(text: string, className = ''): HTMLElement {
    const element = document.createElement('div');
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function stopTooltip(stop: DispoMapStop): HTMLElement {
    const { booking } = stop;
    const element = document.createElement('div');
    element.className = 'dispo-tip';
    element.append(
      line(`Team ${stop.team} · ${stop.number}. Besuch`, 'dispo-tip-muted'),
      line(`${minutesToTime(stop.start)} Familie ${booking.familyName}`, 'dispo-tip-title'),
      line(`${booking.street}, ${booking.postalCode} ${booking.city}`),
      line(
        `Gebucht ${slotLabel(booking.slotKey)} · ${booking.childrenCount} ${
          booking.childrenCount === 1 ? 'Kind' : 'Kinder'
        } · ca. ${stop.end - stop.start} Min${booking.withKrampus ? ' · mit Krampus' : ''}`
      )
    );
    for (const conflict of stop.conflicts) {
      element.append(
        line(
          `⚠ ${conflict.name} – nicht zu Familien mit „${conflict.tags.join('“, „')}“`,
          'dispo-tip-danger'
        )
      );
    }
    if (stop.lateAfterSlot > 0) {
      element.append(
        line(
          `⚠ ${Math.round(stop.lateAfterSlot)} Min nach Ende des gebuchten Termins`,
          'dispo-tip-danger'
        )
      );
    } else if (stop.lateInSlot >= NOTABLE_LATE_IN_SLOT) {
      element.append(line(`${Math.round(stop.lateInSlot)} Min nach Beginn des gebuchten Termins`));
    }
    if (booking.location?.approximate) element.append(line('Nur der Ort wurde gefunden'));
    if (stop.fixed) element.append(line('Team festgehalten'));
    if (stop.visited) element.append(line('✓ Besucht'));
    return element;
  }

  function render(
    L: typeof import('leaflet'),
    element: HTMLDivElement,
    current: DispoMapTeam[]
  ): void {
    if (!map) {
      map = createMap(L, element, { main: true, style: () => chosenStyle });
      layers = L.layerGroup().addTo(map);
      map.on('dragstart', () => (moved = true));
      for (const type of ['wheel', 'dblclick'] as const) {
        element.addEventListener(type, () => (moved = true), { passive: true });
      }
      element.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.leaflet-control-zoom')) {
          moved = true;
        }
      });
      map.on('click', () => {
        selectedId = null;
        pointedLeg = null;
      });
    }
    const group = layers ?? L.layerGroup().addTo(map);
    layers = group;
    group.clearLayers();
    markers = {};
    lines = [];

    const home = L.latLng(base.lat, base.lon);
    const bounds = L.latLngBounds([home]);

    for (const team of current) {
      for (const leg of team.legs) {
        const visible = L.polyline(leg.points, {
          color: team.color,
          weight: 4,
          opacity: 0.85,
          interactive: false,
        }).addTo(group);
        lines.push({ team: team.name, line: visible, leg });
        // A wider invisible line makes the drive easy to point at
        const tip = document.createElement('div');
        tip.className = 'dispo-tip';
        tip.append(
          line(`Team ${team.name} · Fahrt`, 'dispo-tip-muted'),
          line(`${leg.from} → ${leg.to}`, 'dispo-tip-title'),
          line(legSummary(leg, team.kmAlongRoads))
        );
        const point = (): void => {
          pointedLeg = { team: team.name, fromId: leg.fromId, toId: leg.toId };
        };
        L.polyline(leg.points, { color: team.color, weight: 18, opacity: 0 })
          .bindTooltip(tip, { sticky: true })
          .on('mouseover', point)
          .on('mouseout', () => (pointedLeg = null))
          .on('click', (event) => {
            // A tap on a phone: the drive stays pointed at until the next tap on the map
            L.DomEvent.stopPropagation(event);
            point();
          })
          .addTo(group);
      }
      for (const stop of team.stops) {
        // The number stays small; the area around it takes a tap of at least 44px
        const target = document.createElement('span');
        target.className = 'dispo-marker-target';
        const icon = document.createElement('span');
        target.append(icon);
        icon.className = 'dispo-marker';
        if (stop.lateAfterSlot > 0 || stop.conflicts.length > 0) icon.classList.add('is-late');
        if (stop.visited) icon.classList.add('is-visited');
        icon.style.background = team.color;
        icon.textContent = String(stop.number);
        const marker = L.marker(stop.position, {
          icon: L.divIcon({
            className: '',
            html: target,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
          title: `${stop.number}. Familie ${stop.booking.familyName}`,
          alt: `Team ${team.name}, ${stop.number}. Besuch, Familie ${stop.booking.familyName}`,
          riseOnHover: true,
        })
          .bindTooltip(stopTooltip(stop), { direction: 'top', offset: [0, -14] })
          .on('click', (event) => {
            L.DomEvent.stopPropagation(event);
            select(stop.id, false);
          })
          .addTo(group);
        markers[stop.id] = { marker, element: icon, team: team.name };
      }
      for (const point of routePoints(team)) bounds.extend(point);
    }

    baseMarker = L.circleMarker(home, {
      radius: 9,
      color: '#ffffff',
      fillColor: '#003056',
      fillOpacity: 1,
      weight: 3,
    })
      .bindTooltip(base.name)
      .addTo(group);

    map.invalidateSize();
    const key = current.map((team) => team.name).join(',');
    const roads = current.map((team) => `${team.name}:${team.kmAlongRoads}`).join(',');
    if (key !== fittedTo || (roads !== fittedRoads && !moved)) {
      fittedTo = key;
      fittedRoads = roads;
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
    }
  }

  function applyStyles(): void {
    const leg = pointedLeg;
    const focusTeam = leg?.team ?? highlight;
    for (const { team, line, leg: drawn } of lines) {
      const pointed =
        leg !== null && team === leg.team && drawn.fromId === leg.fromId && drawn.toId === leg.toId;
      const faded = focusTeam !== null && team !== focusTeam;
      line.setStyle(
        pointed ? { weight: 8, opacity: 1 } : { weight: 4, opacity: faded ? 0.2 : 0.85 }
      );
    }
    const ends = leg ? [leg.fromId, leg.toId] : [];
    for (const [id, { marker, element, team }] of Object.entries(markers)) {
      const end = ends.includes(id);
      element.classList.toggle('is-faded', focusTeam !== null && team !== focusTeam);
      element.classList.toggle('is-selected', id === selectedId);
      element.classList.toggle('is-leg-end', end);
      marker.setZIndexOffset(id === selectedId || end ? 1000 : 0);
    }
    baseMarker?.setRadius(leg && (leg.fromId === null || leg.toId === null) ? 13 : 9);
  }

  /** Selects a visit and moves the map to it. */
  function select(id: string, move = true): void {
    selectedId = id;
    moved = true;
    void tick().then(() => revealItem(id, move));
    const entry = markers[id];
    if (!entry || !map) return;
    if (move) map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.5 });
    entry.marker.openTooltip();
  }

  let panel = $state<HTMLElement | null>(null);
  let mapArea = $state<HTMLElement | null>(null);

  /**
   * Shows the chosen visit in the panel when it scrolls on its own (next to the map). Below the
   * map on a phone the page would scroll away from the map, so it brings the map into view.
   */
  function revealItem(id: string, fromPanel: boolean): void {
    const item = document.getElementById(`dispo-map-item-${id}`);
    if (!panel || !item) return;
    if (panel.scrollHeight > panel.clientHeight + 1) {
      const top = item.offsetTop - panel.offsetTop;
      if (top < panel.scrollTop || top + item.offsetHeight > panel.scrollTop + panel.clientHeight) {
        panel.scrollTo({ top: top - panel.clientHeight / 3, behavior: 'smooth' });
      }
    } else if (fromPanel) {
      bringMapIntoView();
    }
  }

  /** On a phone the panel sits below the map; an action there scrolls back up to the map. */
  function bringMapIntoView(): void {
    if (!mapArea || large) return;
    const { top } = mapArea.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight / 2) {
      mapArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** Visits and the course of the drives, which may leave the area of the visits. */
  function routePoints(team: DispoMapTeam): [number, number][] {
    return [...team.stops.map((stop) => stop.position), ...team.legs.flatMap((leg) => leg.points)];
  }

  function fitTeams(names: string[]): void {
    if (!map || !leaflet) return;
    moved = true;
    const points = teams
      .filter((team) => names.includes(team.name))
      .flatMap((team) => routePoints(team));
    const bounds = leaflet.latLngBounds([[base.lat, base.lon], ...points]);
    map.flyToBounds(bounds, { padding: [32, 32], maxZoom: 15, duration: 0.5 });
    bringMapIntoView();
  }

  function toggleTeam(name: string): void {
    hidden = hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name];
    if (selected && hidden.includes(selected.team)) selectedId = null;
  }

  function onlyTeam(name: string): void {
    hidden = teams.map((team) => team.name).filter((n) => n !== name);
    if (selected && selected.team !== name) selectedId = null;
  }

  function pointAt(id: string | null): void {
    for (const [stopId, { marker, element }] of Object.entries(markers)) {
      element.classList.toggle('is-pointed', stopId === id);
      if (stopId === id) marker.openTooltip();
      else if (stopId !== selectedId) marker.closeTooltip();
    }
  }

  /** Fades the other routes while the mouse is on a team; a tap would leave them faded. */
  function pointTeam(event: PointerEvent, name: string): void {
    if (event.pointerType === 'mouse') highlight = name;
  }

  let view = $state<HTMLElement | null>(null);
  let largeButton = $state<HTMLButtonElement | null>(null);
  /** Page parts hidden behind the Großansicht, which keyboard and screen reader must skip. */
  let covered: HTMLElement[] = [];

  async function toggleLarge(): Promise<void> {
    large = !large;
    // The page content is a layer below the site header; lift it while the map fills the screen
    document.body.classList.toggle('dispo-map-large', large);
    for (const element of covered) element.inert = false;
    covered = [];
    if (large && view) {
      for (let node: HTMLElement = view; node.parentElement; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
            sibling.inert = true;
            covered.push(sibling);
          }
        }
      }
    }
    await tick();
    map?.invalidateSize();
    largeButton?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (large) void toggleLarge();
    else selectedId = null;
  }

  onDestroy(() => {
    document.body.classList.remove('dispo-map-large');
    for (const element of covered) element.inert = false;
    map?.remove();
    map = null;
    layers = null;
  });
</script>

<svelte:window {onkeydown} />

<div bind:this={view} class="map-view {large ? 'is-large' : ''} print:hidden">
  <div class="map-area scroll-mt-28" bind:this={mapArea}>
    <div
      bind:this={container}
      class="dispo-map dispo-map-main overflow-hidden rounded-md border border-[var(--color-brand-200)]"
      role="region"
      aria-label="Karte mit den Routen der Teams"
    ></div>
    <div class="map-controls">
      <button
        type="button"
        class="map-button"
        onclick={() => fitTeams(shown.map((team) => team.name))}
      >
        Alle Routen zeigen
      </button>
      <button
        bind:this={largeButton}
        type="button"
        class="map-button"
        aria-pressed={large}
        onclick={toggleLarge}
      >
        {large ? 'Großansicht beenden' : 'Großansicht'}
      </button>
    </div>
    <div class="map-style">
      <FilterTabs
        label="Kartenfarbe"
        variant="segmented"
        options={[
          { value: 'hell', label: 'Helle Karte' },
          { value: 'dunkel', label: 'Dunkle Karte' },
        ]}
        value={mapStyle}
        onselect={chooseStyle}
      />
    </div>
  </div>

  <aside class="map-panel" aria-label="Teams und Termine" bind:this={panel}>
    <section aria-labelledby="dispo-map-teams">
      <h2 id="dispo-map-teams" class="text-sm font-semibold text-neutral-900">
        Teams auf der Karte
      </h2>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each teams as team (team.name)}
          <button
            type="button"
            class="team-chip"
            aria-pressed={!hidden.includes(team.name)}
            onclick={() => toggleTeam(team.name)}
            onpointerenter={(event) => pointTeam(event, team.name)}
            onpointerleave={() => (highlight = null)}
            onfocus={(event) => {
              // Only for the keyboard: a tap also focuses the button
              if (event.currentTarget.matches(':focus-visible')) highlight = team.name;
            }}
            onblur={() => (highlight = null)}
          >
            <span class="team-dot" style:background={team.color} aria-hidden="true"></span>
            Team {team.name}
            <span class="tabular-nums text-neutral-700"
              >({team.stops.length + team.unlocated.length})</span
            >
            <span class="font-normal text-neutral-700"
              >{hidden.includes(team.name) ? 'ausgeblendet' : 'eingeblendet'}</span
            >
          </button>
        {/each}
      </div>
      {#if hidden.length > 0}
        <button
          type="button"
          class="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-link underline"
          onclick={() => (hidden = [])}
        >
          Alle Teams zeigen
        </button>
      {/if}
    </section>

    {#if selected}
      {@const booking = selected.booking}
      <section
        aria-labelledby="dispo-map-selected"
        class="selected-card mt-4 rounded-md border-l-4 p-3 text-sm"
        style:border-left-color={teams.find((team) => team.name === selected.team)?.color}
      >
        <p class="text-neutral-700">Team {selected.team} · {selected.number}. Besuch</p>
        <h2 id="dispo-map-selected" class="font-semibold text-neutral-900">
          <span class="tabular-nums">{minutesToTime(selected.start)}</span>
          Familie {booking.familyName}
        </h2>
        <p class="text-neutral-800">{booking.street}, {booking.postalCode} {booking.city}</p>
        <p class="mt-1 text-neutral-700">
          Gebucht {slotLabel(booking.slotKey)} · Ankunft {minutesToTime(selected.arrival)}
          <br />{booking.childrenCount}
          {booking.childrenCount === 1 ? 'Kind' : 'Kinder'} · ca. {selected.end - selected.start} Min
          {#if booking.withKrampus}· mit Krampus{/if}
        </p>
        {#if booking.phone}
          <p class="text-neutral-700">
            Tel.: <a
              class="text-link inline-flex min-h-11 items-center underline"
              href="tel:{booking.phone}">{booking.phone}</a
            >
          </p>
        {/if}
        {#if selected.lateAfterSlot > 0}
          <p class="mt-1 font-semibold text-danger">
            ⚠ {Math.round(selected.lateAfterSlot)} Min nach Ende des gebuchten Termins
          </p>
        {:else if selected.lateInSlot >= NOTABLE_LATE_IN_SLOT}
          <p class="mt-1 text-warning">
            {Math.round(selected.lateInSlot)} Min nach Beginn des gebuchten Termins
          </p>
        {/if}
        {#each selected.conflicts as conflict (conflict.name)}
          <p class="mt-1 font-semibold text-danger">
            ⚠ {conflict.name} – nicht zu Familien mit „{conflict.tags.join('“, „')}“
          </p>
        {/each}
        {#if booking.notes}
          <p class="mt-1"><span class="font-semibold">Bemerkungen:</span> {booking.notes}</p>
        {/if}
        {#if selected.visited}
          <p class="mt-1 font-semibold text-success">✓ Besucht</p>
        {/if}
        <!-- A visit already checked off stays with its team, as in the list -->
        {#if !selected.visited}
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <label class="sr-only" for="dispo-map-team-select"
              >Team für Familie {booking.familyName}</label
            >
            <select
              id="dispo-map-team-select"
              class="form-input mt-0! w-auto py-1.5 text-sm"
              value={selected.team}
              onchange={(event) => onteam(selected.id, event.currentTarget.value)}
            >
              {#each options as option (option.name)}
                <option value={option.name}>Team {option.name}</option>
              {/each}
            </select>
            <PinToggle
              fixed={selected.fixed}
              label={`für Familie ${booking.familyName}`}
              onclick={() => onpin(selected.id, selected.team)}
            />
          </div>
        {/if}
        <div class="mt-1 flex flex-wrap gap-x-4">
          <button
            type="button"
            class="inline-flex min-h-11 items-center font-semibold text-link underline"
            onclick={() => onlist(selected.id)}
          >
            In der Liste zeigen
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center font-semibold text-link underline"
            onclick={() => (selectedId = null)}
          >
            Schließen
          </button>
        </div>
      </section>
    {/if}

    {#if late.length > 0}
      <section aria-labelledby="dispo-map-late" class="mt-4 text-sm">
        <h2 id="dispo-map-late" class="font-semibold text-danger">
          {late.length} nach Ende des gebuchten Termins
        </h2>
        <ul class="mt-1">
          {#each late as stop (stop.id)}
            <li>
              <button
                type="button"
                class="inline-flex min-h-11 items-center text-left text-link underline"
                onclick={() => select(stop.id)}
              >
                Team {stop.team}: Familie {stop.booking.familyName}, {Math.round(
                  stop.lateAfterSlot
                )} Min zu spät
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#each shown as team (team.name)}
      <section
        aria-labelledby="dispo-map-team-{team.name}"
        class="mt-4 border-t-4 pt-2"
        style:border-top-color={team.color}
        onpointerenter={(event) => pointTeam(event, team.name)}
        onpointerleave={() => (highlight = null)}
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2
            id="dispo-map-team-{team.name}"
            class="font-serif text-lg font-semibold text-brand-900"
          >
            Team {team.name}
          </h2>
          <span class="flex gap-x-3">
            <button
              type="button"
              class="inline-flex min-h-11 items-center text-sm font-semibold text-link underline"
              onclick={() => fitTeams([team.name])}
            >
              Route zeigen
            </button>
            {#if shown.length > 1}
              <button
                type="button"
                class="inline-flex min-h-11 items-center text-sm font-semibold text-link underline"
                onclick={() => onlyTeam(team.name)}
              >
                Nur dieses Team
              </button>
            {/if}
          </span>
        </div>
        {#if team.departure !== null && team.returnTime !== null}
          <p class="text-sm text-neutral-700">
            Abfahrt {minutesToTime(team.departure)} · zurück ca. {minutesToTime(team.returnTime)}
            · Fahrzeit {Math.round(team.driveMinutes)} Min
            {#if teamKmLabel(team)}· Strecke {teamKmLabel(team)}{/if}
          </p>
        {:else}
          <p class="text-sm text-neutral-700">Keine Termine.</p>
        {/if}
        <ol class="mt-1">
          {#each team.stops as stop (stop.id)}
            <li id="dispo-map-item-{stop.id}">
              <button
                type="button"
                class="stop-item"
                class:is-leg-end={legEnds.includes(stop.id)}
                aria-current={stop.id === selectedId ? 'true' : undefined}
                onclick={() => select(stop.id)}
                onpointerenter={(event) => event.pointerType === 'mouse' && pointAt(stop.id)}
                onpointerleave={() => pointAt(null)}
              >
                <span class="stop-number" style:background={team.color} aria-hidden="true"
                  >{stop.number}</span
                >
                <span class="tabular-nums font-semibold">{minutesToTime(stop.start)}</span>
                <span class="min-w-0 flex-1 truncate">Familie {stop.booking.familyName}</span>
                {#if stop.conflicts.length > 0}
                  <span class="text-danger font-semibold">⚠ Merkmal</span>
                {:else if stop.lateAfterSlot > 0}
                  <span class="text-danger font-semibold">⚠ zu spät</span>
                {:else if stop.visited}
                  <span class="text-success">✓ besucht</span>
                {/if}
              </button>
            </li>
          {/each}
        </ol>
      </section>
    {/each}

    {#if unlocated.length > 0}
      <section aria-labelledby="dispo-map-unlocated" class="mt-4 text-sm">
        <h2 id="dispo-map-unlocated" class="font-semibold text-warning">Nicht auf der Karte</h2>
        <ul class="mt-1">
          {#each unlocated as entry (entry.booking.id)}
            <li>
              <button
                type="button"
                class="inline-flex min-h-11 items-center text-left text-link underline"
                onclick={() => onlist(entry.booking.id)}
              >
                Team {entry.team}: Familie {entry.booking.familyName} – in der Liste zeigen
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>
</div>

<style>
  .map-view {
    display: grid;
    gap: calc(var(--spacing) * 4);
  }
  /* Printed is the list; the component's own display would win over print:hidden */
  @media print {
    .map-view,
    .map-view.is-large {
      display: none;
    }
    :global(body.dispo-map-large) {
      overflow: visible;
    }
  }
  .map-area {
    position: relative;
  }
  .dispo-map-main {
    background: var(--color-neutral-100);
    height: 65vh;
    min-height: 360px;
    /* Keep Leaflet's panes below the sticky site header */
    position: relative;
    z-index: 0;
  }
  .map-controls {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: calc(var(--spacing) * 2);
  }
  .map-style {
    position: absolute;
    bottom: 1.75rem;
    left: 0.75rem;
    z-index: 1;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
    border-radius: 0.375rem;
  }
  .map-button {
    min-height: calc(var(--spacing) * 11);
    border: 1px solid var(--color-neutral-300);
    border-radius: 0.375rem;
    background: var(--color-surface);
    padding: 0 calc(var(--spacing) * 3);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-brand-900);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
  }
  .map-button:hover {
    background: var(--color-field);
  }
  .team-chip {
    display: inline-flex;
    min-height: calc(var(--spacing) * 11);
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border: 1px solid var(--color-neutral-300);
    border-radius: 9999px;
    padding: 0 calc(var(--spacing) * 3.5);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-neutral-700);
  }
  .team-chip[aria-pressed='true'] {
    border-color: var(--color-brand-900);
    color: var(--color-brand-900);
    background: var(--color-field);
  }
  .team-chip[aria-pressed='false'] .team-dot {
    opacity: 0.3;
  }
  .team-dot {
    height: 0.875rem;
    width: 0.875rem;
    border-radius: 9999px;
    border: 2px solid white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.3);
  }
  .selected-card {
    background: var(--color-field);
  }
  .stop-item {
    display: flex;
    width: 100%;
    min-height: calc(var(--spacing) * 11);
    align-items: center;
    gap: calc(var(--spacing) * 2);
    border-radius: 0.375rem;
    padding: 0 calc(var(--spacing) * 2);
    text-align: left;
    font-size: 0.875rem;
    color: var(--color-neutral-900);
  }
  .stop-item:hover,
  .stop-item.is-leg-end,
  .stop-item[aria-current='true'] {
    background: var(--color-field);
  }
  .stop-item.is-leg-end {
    box-shadow: inset 4px 0 0 var(--color-brand-900);
    font-weight: 600;
  }
  .stop-number {
    display: flex;
    height: 1.5rem;
    width: 1.5rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
    color: white;
  }

  @media (min-width: 1024px) {
    .map-view {
      grid-template-columns: minmax(0, 1fr) 22rem;
      align-items: start;
    }
    .dispo-map-main {
      height: calc(100vh - 12rem);
      min-height: 520px;
    }
    .map-panel {
      max-height: calc(100vh - 12rem);
      min-height: 520px;
      overflow-y: auto;
      padding-right: var(--spacing);
    }
  }

  /* Großansicht: map and panel fill the whole screen */
  :global(body.dispo-map-large) {
    overflow: hidden;
  }
  :global(body.dispo-map-large main) {
    z-index: 60;
  }
  /* The view has its own button to leave it */
  :global(body.dispo-map-large .staff-bottom-bar) {
    display: none;
  }
  .map-view.is-large {
    position: fixed;
    inset: 0;
    z-index: 60;
    gap: 0;
    background: var(--color-surface);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .is-large .dispo-map-main {
    height: 100%;
    min-height: 0;
    border-radius: 0;
    border: 0;
  }
  .is-large .map-area {
    height: 100%;
    min-height: 0;
  }
  .is-large .map-panel {
    max-height: 40vh;
    overflow-y: auto;
    padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
  }
  @media (min-width: 1024px) {
    .map-view.is-large {
      grid-template-rows: none;
      grid-template-columns: minmax(0, 1fr) 24rem;
    }
    .is-large .map-panel {
      max-height: 100vh;
      height: 100vh;
      min-height: 0;
    }
  }

  :global(.dispo-marker-target) {
    display: flex;
    height: 44px;
    width: 44px;
    align-items: center;
    justify-content: center;
  }
  :global(.dispo-map-main .dispo-marker) {
    display: flex;
    height: 28px;
    width: 28px;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    border-radius: 9999px;
    color: white;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    transition:
      transform 0.15s,
      opacity 0.15s;
  }
  :global(.dispo-marker.is-late) {
    outline: 3px solid var(--color-danger);
    outline-offset: 1px;
  }
  :global(.dispo-marker.is-visited) {
    opacity: 0.7;
  }
  :global(.dispo-marker.is-faded) {
    opacity: 0.25;
  }
  :global(.dispo-marker.is-selected),
  :global(.dispo-marker.is-leg-end),
  :global(.dispo-marker.is-pointed) {
    transform: scale(1.35);
    opacity: 1;
  }
  :global(.dispo-marker.is-leg-end) {
    box-shadow:
      0 0 0 3px white,
      0 0 0 6px var(--color-brand-900);
  }
  :global(.dispo-tip) {
    width: max-content;
    max-width: 18rem;
    white-space: normal;
    font-size: 13px;
    line-height: 1.35;
  }
  :global(.dispo-tip-title) {
    font-weight: 700;
  }
  :global(.dispo-tip-muted) {
    color: #4b5563;
  }
  :global(.dispo-tip-danger) {
    color: #810a1a;
    font-weight: 700;
  }
</style>
