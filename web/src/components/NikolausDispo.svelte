<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, postApi, sendApi } from '../lib/api';
  import { NIKOLAUS_CONFIG, NIKOLAUS_SLOT_MINUTES } from '../lib/nikolausConfig';
  import {
    evaluateDispo,
    minutesToTime,
    moveStop,
    solveDispo,
    timeToMinutes,
    visitMinutes,
  } from '../lib/nikolausDispo';
  import type { DispoAssignment, DispoPlannedStop, DispoProblem } from '../lib/nikolausDispo';
  import { fetchNikolausDispo, nikolausDispoStore } from '../lib/nikolausDispoStore.svelte';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import type {
    StaffNikolausBooking,
    StaffNikolausDispoData,
    StaffNikolausDispoRow,
    StaffNikolausDispoSaved,
  } from '../lib/types';
  import { conflictingTags } from '../lib/nikolausEinteilung';
  import NikolausDispoMap from './NikolausDispoMap.svelte';
  import type { DispoMapRoute } from './NikolausDispoMap.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  /** Delays by which a visit is marked in the list. */
  const NOTABLE_LATE_IN_SLOT = 10;
  /** Google Maps accepts at most 9 waypoints between origin and destination. */
  const MAPS_MAX_WAYPOINTS = 9;

  const { base } = NIKOLAUS_CONFIG.area;
  const dates = [...NIKOLAUS_CONFIG.days].map((d) => d.date).sort();

  interface Notice {
    text: string;
    kind: 'success' | 'warning' | 'error';
  }

  let date = $state(dates[0] ?? '');
  let assignment = $state<DispoAssignment>({});
  /** Team assignments set by hand (booking ID → team); kept when recalculating. */
  let fixed = $state<Record<string, string>>({});
  let dirty = $state(false);
  let saving = $state(false);
  let calculating = $state(false);
  let notice = $state<Notice | null>(null);
  let conflict = $state(false);
  /** Hints about changes since the Dispo was saved. */
  let changes = $state<string[]>([]);

  const data = $derived(nikolausDispoStore.data?.date === date ? nikolausDispoStore.data : null);
  const stopsById = $derived(new Map((data?.stops ?? []).map((stop) => [stop.id, stop])));
  const rowsById = $derived(new Map((data?.rows ?? []).map((row) => [row.bookingId, row])));
  const teamColor = $derived(new Map((data?.teams ?? []).map((t) => [t.name, t.color])));

  /** Negative tags of a team's helpers that match a family's tags. */
  function tagConflicts(
    source: StaffNikolausDispoData,
    booking: StaffNikolausBooking,
    team: string
  ): { name: string; tags: string[] }[] {
    return (source.members[team] ?? []).flatMap((member) => {
      const tags = conflictingTags(member, [booking.internalTags]);
      return tags.length > 0 ? [{ name: member.name, tags }] : [];
    });
  }

  function toProblem(source: StaffNikolausDispoData): DispoProblem {
    // Families must not go to a team with a helper who has a matching negative tag
    const forbidden: Record<string, string[]> = {};
    for (const booking of source.stops) {
      const teams = source.teams
        .map((team) => team.name)
        .filter((team) => tagConflicts(source, booking, team).length > 0);
      if (teams.length > 0) forbidden[booking.id] = teams;
    }
    return {
      forbidden,
      stops: source.stops.map((booking) => {
        const slotStart = timeToMinutes(booking.slotKey.split('T')[1] ?? '00:00');
        return {
          id: booking.id,
          slotStart,
          slotEnd: slotStart + NIKOLAUS_SLOT_MINUTES,
          duration: visitMinutes(booking.childrenCount),
        };
      }),
      teams: source.teams.map((team) => team.name),
      travel: source.travel,
    };
  }

  const problem = $derived(data ? toProblem(data) : null);
  const plan = $derived(problem ? evaluateDispo(problem, assignment) : null);

  const totals = $derived.by(() => {
    const stops = plan?.routes.flatMap((route) => route.stops) ?? [];
    return {
      drive: Math.round(plan?.routes.reduce((sum, route) => sum + route.driveMinutes, 0) ?? 0),
      lateAfterSlot: stops.filter((stop) => stop.lateAfterSlot > 0).length,
    };
  });

  /** Wait this long after the last change before asking for the course along the roads. */
  const ROUTE_PATH_DELAY_MS = 600;

  /** Course of each team's route along the roads, with the route it was requested for. */
  let routePaths = $state.raw<Record<string, { key: string; path: [number, number][] }>>({});
  /** Route last requested per team; not reactive, so a failed request is not repeated. */
  const requestedPaths: Record<string, string> = {};

  function routeKey(ids: string[] | undefined): string {
    return (ids ?? []).join(',');
  }

  // Fetch the courses along the roads for the map once the routes stop changing. Until the
  // answer arrives (or without the routing service) the map draws straight lines.
  $effect(() => {
    if (!data) return;
    const current = $state.snapshot(assignment) as DispoAssignment;
    const day = data.date;
    const timer = setTimeout(async () => {
      const missing = Object.entries(current).filter(
        ([team, ids]) => ids.length > 0 && requestedPaths[`${day}/${team}`] !== routeKey(ids)
      );
      if (missing.length === 0) return;
      for (const [team, ids] of missing) requestedPaths[`${day}/${team}`] = routeKey(ids);
      try {
        const { paths } = await postApi<{ paths: Record<string, [number, number][] | null> }>(
          `/intern/nikolaus/dispo/routes?date=${encodeURIComponent(day)}`,
          { routes: Object.fromEntries(missing) }
        );
        const next = { ...routePaths };
        for (const [team, ids] of missing) {
          const path = paths[team];
          if (path) next[team] = { key: `${day}/${routeKey(ids)}`, path };
        }
        routePaths = next;
      } catch {
        // Only cosmetic: the map keeps its straight lines
      }
    }, ROUTE_PATH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const mapRoutes = $derived.by((): DispoMapRoute[] =>
    (plan?.routes ?? []).map((route) => ({
      team: route.team,
      color: teamColor.get(route.team) ?? '#003056',
      path:
        routePaths[route.team]?.key === `${date}/${routeKey(assignment[route.team])}`
          ? routePaths[route.team].path
          : null,
      stops: route.stops.flatMap((planned) => {
        const booking = stopsById.get(planned.id);
        return booking?.location
          ? [
              {
                lat: booking.location.lat,
                lon: booking.location.lon,
                label: `${minutesToTime(planned.start)} Familie ${booking.familyName}`,
              },
            ]
          : [];
      }),
    }))
  );

  /** Puts a stop into the team where it adds the least cost. */
  function insertCheapest(
    target: DispoProblem,
    current: DispoAssignment,
    id: string
  ): DispoAssignment {
    let best = current;
    let bestCost = Infinity;
    for (const team of target.teams) {
      const candidate = moveStop(target, current, id, team);
      const cost = evaluateDispo(target, candidate).cost;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    return best;
  }

  /** Builds the working state from the loaded data: the saved Dispo or a new suggestion. */
  function initFrom(source: StaffNikolausDispoData): void {
    const target = toProblem(source);
    const bookings = new Map(source.stops.map((stop) => [stop.id, stop]));
    changes = [];
    conflict = false;

    if (source.rows.length === 0) {
      fixed = {};
      assignment = solveDispo(target);
      dirty = source.stops.length > 0;
      notice =
        source.stops.length > 0
          ? { text: 'Vorschlag berechnet – noch nicht gespeichert.', kind: 'warning' }
          : null;
      return;
    }

    const next: DispoAssignment = Object.fromEntries(target.teams.map((team) => [team, []]));
    const nextFixed: Record<string, string> = {};
    const hints: string[] = [];
    const sorted = [...source.rows].sort((a, b) => a.order - b.order);
    for (const row of sorted) {
      const booking = bookings.get(row.bookingId);
      if (!booking) {
        hints.push(
          `Ein gespeicherter Termin (Buchung ${row.bookingId}) ist nicht mehr bestätigt oder wurde auf einen anderen Tag verlegt. Er wird beim Speichern aus der Dispo entfernt.`
        );
        continue;
      }
      if (!next[row.team]) {
        hints.push(
          `Familie ${booking.familyName} war Team ${row.team} zugeordnet, das es an diesem Tag nicht mehr gibt.`
        );
        continue;
      }
      next[row.team].push(row.bookingId);
      if (row.fixed) nextFixed[row.bookingId] = row.team;
      if (row.slotKey !== booking.slotKey) {
        hints.push(
          `Familie ${booking.familyName} wurde seit dem Speichern auf ${booking.slotKey.split('T')[1]} Uhr verlegt – am besten neu berechnen.`
        );
      }
    }

    let merged = next;
    for (const stop of source.stops) {
      if (!Object.values(merged).some((ids) => ids.includes(stop.id))) {
        merged = insertCheapest(target, merged, stop.id);
        const team = Object.keys(merged).find((name) => merged[name].includes(stop.id));
        hints.push(`Neuer Termin: Familie ${stop.familyName} wurde Team ${team} zugeordnet.`);
      }
    }

    assignment = merged;
    fixed = nextFixed;
    changes = hints;
    dirty = hints.length > 0;
  }

  $effect(() => {
    if (data) {
      const current = data;
      untrack(() => initFrom(current));
    }
  });

  $effect(() => {
    untrack(() => {
      const param = new URLSearchParams(window.location.search).get('tag');
      const today = new Date().toISOString().slice(0, 10);
      date =
        (param && dates.includes(param) ? param : dates.find((d) => d >= today)) ?? dates[0] ?? '';
      if (date) void fetchNikolausDispo(date);
    });
  });

  $effect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  function selectDate(next: string): void {
    if (next === date) return;
    if (
      dirty &&
      !confirm('Die Änderungen an der Dispo sind noch nicht gespeichert. Trotzdem wechseln?')
    ) {
      return;
    }
    date = next;
    dirty = false;
    notice = null;
    const url = new URL(window.location.href);
    url.searchParams.set('tag', next);
    history.replaceState(history.state, '', url);
    void fetchNikolausDispo(next);
  }

  function reload(): void {
    if (
      dirty &&
      !confirm('Die Änderungen an der Dispo sind noch nicht gespeichert. Trotzdem neu laden?')
    ) {
      return;
    }
    dirty = false;
    notice = null;
    void fetchNikolausDispo(date);
  }

  function recalculate(): void {
    if (!problem) return;
    const target = { ...problem, fixed: $state.snapshot(fixed) };
    calculating = true;
    // Let the browser show the busy state before the calculation blocks it for a moment
    setTimeout(() => {
      assignment = solveDispo(target);
      calculating = false;
      dirty = true;
      notice = { text: 'Neu berechnet – noch nicht gespeichert.', kind: 'warning' };
    }, 30);
  }

  function changeTeam(id: string, team: string): void {
    if (!problem) return;
    assignment = moveStop(problem, $state.snapshot(assignment), id, team);
    fixed = { ...fixed, [id]: team };
    dirty = true;
    notice = null;
  }

  function toggleFixed(id: string, team: string): void {
    const next = { ...fixed };
    if (next[id]) delete next[id];
    else next[id] = team;
    fixed = next;
    dirty = true;
  }

  async function save(): Promise<void> {
    if (!plan || !data) return;
    saving = true;
    notice = null;
    const entries = plan.routes.flatMap((route) =>
      route.stops.map((stop, i) => ({
        bookingId: stop.id,
        team: route.team,
        order: i + 1,
        plannedArrival: minutesToTime(stop.start),
        fixed: fixed[stop.id] === route.team,
      }))
    );
    try {
      const saved = await sendApi<StaffNikolausDispoSaved>(
        'PUT',
        `/intern/pflege/nikolaus-dispo?date=${encodeURIComponent(date)}`,
        { version: data.version, entries }
      );
      nikolausDispoStore.data = { ...data, rows: saved.rows, version: saved.version };
      notice = { text: 'Dispo gespeichert.', kind: 'success' };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        conflict = true;
        notice = {
          text: 'Die Dispo wurde inzwischen von jemand anderem geändert. Bitte neu laden – deine Änderungen gehen dabei verloren.',
          kind: 'error',
        };
      } else {
        const message =
          error instanceof ApiError && error.fields?.entries ? error.fields.entries : null;
        notice = {
          text:
            message ??
            'Die Speicherung konnte nicht bestätigt werden. Dein Entwurf bleibt erhalten. Klicke erneut auf Speichern, um denselben vollständigen Plan zu sichern. Bei einem Konflikt lade den aktuellen Stand neu.',
          kind: 'error',
        };
      }
    } finally {
      saving = false;
    }
  }

  function routeChildren(ids: string[]): number {
    return ids.reduce((sum, id) => sum + (stopsById.get(id)?.childrenCount ?? 0), 0);
  }

  function mapsPoint(booking: StaffNikolausBooking): string {
    return booking.location && !booking.location.approximate
      ? `${booking.location.lat},${booking.location.lon}`
      : `${booking.street}, ${booking.postalCode} ${booking.city}`;
  }

  /** Google Maps links for a route, split into parts if it has too many stops. */
  function mapsLinks(ids: string[]): string[] {
    const home = `${base.lat},${base.lon}`;
    const points = [
      home,
      ...ids.flatMap((id) => {
        const booking = stopsById.get(id);
        return booking ? [mapsPoint(booking)] : [];
      }),
      home,
    ];
    const links: string[] = [];
    for (let start = 0; start < points.length - 1; start += MAPS_MAX_WAYPOINTS + 1) {
      const part = points.slice(start, start + MAPS_MAX_WAYPOINTS + 2);
      const params: Record<string, string> = {
        api: '1',
        origin: part[0],
        destination: part[part.length - 1],
        travelmode: 'driving',
      };
      if (part.length > 2) params.waypoints = part.slice(1, -1).join('|');
      const query = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      links.push(`https://www.google.com/maps/dir/?${query}`);
    }
    return links;
  }

  function slotLabel(slotKey: string): string {
    const time = slotKey.split('T')[1] ?? '';
    return time ? `${time}–${minutesToTime(timeToMinutes(time) + NIKOLAUS_SLOT_MINUTES)}` : '';
  }

  function visitedRow(id: string): StaffNikolausDispoRow | undefined {
    const row = rowsById.get(id);
    return row?.visited ? row : undefined;
  }
</script>

{#snippet stopCard(planned: DispoPlannedStop, index: number, team: string)}
  {@const booking = stopsById.get(planned.id)}
  {#if booking}
    {@const selectId = `dispo-team-${booking.id}`}
    {@const isFixed = fixed[booking.id] === team}
    {@const visited = visitedRow(booking.id)}
    <li class="stop-card py-3 text-sm">
      <div class="flex items-start gap-3">
        <span
          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style:background={teamColor.get(team)}
          aria-hidden="true">{index + 1}</span
        >
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-baseline gap-x-2">
            <span class="text-base font-semibold tabular-nums text-brand-900"
              >{minutesToTime(planned.start)}</span
            >
            <span class="text-neutral-700">Slot {slotLabel(booking.slotKey)}</span>
          </p>
          <p class="font-semibold text-neutral-900">Familie {booking.familyName}</p>
          <p class="text-neutral-800">
            {booking.street}, {booking.postalCode}
            {booking.city}
          </p>
          <p class="mt-1 text-neutral-700">
            {booking.childrenCount}
            {booking.childrenCount === 1 ? 'Kind' : 'Kinder'} · ca. {planned.end - planned.start} Min
            {#if booking.withKrampus}· mit Krampus{/if}
            · Anfahrt {Math.round(planned.driveMinutes)} Min
          </p>
          {#if booking.phone}
            <p class="text-neutral-700">
              Tel.: <a class="text-brand-800 underline" href="tel:{booking.phone}"
                >{booking.phone}</a
              >
            </p>
          {/if}
          {#if booking.internalTags.length > 0}
            <p
              class="mt-1 flex flex-wrap gap-x-2 text-xs text-neutral-700"
              aria-label="Interne Tags"
            >
              {#each booking.internalTags as tag (tag)}
                <span class="tag">{tag}</span>
              {/each}
            </p>
          {/if}
          {#if data}
            {#each tagConflicts(data, booking, team) as conflict (conflict.name)}
              <p class="mt-1 font-semibold text-[var(--color-dpsg-red)]">
                ⚠ Tag-Konflikt: {conflict.name} hat den negativen Tag „{conflict.tags.join('“, „')}“
              </p>
            {/each}
          {/if}
          {#if booking.hidingPlace}
            <p class="mt-1"><span class="font-semibold">Versteck:</span> {booking.hidingPlace}</p>
          {/if}
          {#if booking.addressNotes}
            <p><span class="font-semibold">Adresse:</span> {booking.addressNotes}</p>
          {/if}
          {#if booking.notes}
            <p><span class="font-semibold">Bemerkungen:</span> {booking.notes}</p>
          {/if}

          {#if planned.lateAfterSlot > 0}
            <p class="mt-1 font-semibold text-[var(--color-dpsg-red)]">
              ⚠ {Math.round(planned.lateAfterSlot)} Min nach Ende des Slots
            </p>
          {:else if planned.lateInSlot >= NOTABLE_LATE_IN_SLOT}
            <p class="mt-1 text-[#8a4a00]">
              {Math.round(planned.lateInSlot)} Min nach Beginn des Slots
            </p>
          {/if}
          {#if !booking.location}
            <p class="mt-1 text-[#8a4a00]">
              Adresse nicht auf der Karte gefunden – Fahrzeit nur geschätzt
            </p>
          {:else if booking.location.approximate}
            <p class="mt-1 text-[#8a4a00]">Nur der Ort wurde gefunden – Fahrzeit ungenau</p>
          {/if}
          {#if visited}
            <p class="mt-1 font-semibold text-[var(--color-dpsg-pfadfinder)]">
              ✓ Besucht{visited.visitedAt ? ` um ${visited.visitedAt} Uhr` : ''}
            </p>
          {/if}

          <div class="mt-2 flex flex-wrap items-center gap-2 print:hidden">
            <label class="sr-only" for={selectId}>Team für Familie {booking.familyName}</label>
            <select
              id={selectId}
              class="form-input mt-0! w-auto py-1.5 text-sm"
              value={team}
              onchange={(event) => changeTeam(booking.id, event.currentTarget.value)}
            >
              {#each data?.teams ?? [] as option (option.name)}
                <option value={option.name}>Team {option.name}</option>
              {/each}
            </select>
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-1.5 border-b-2 border-transparent text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-[var(--color-dpsg-red)] aria-[pressed=true]:text-brand-900"
              aria-pressed={isFixed}
              title="Fixierte Termine behalten beim Neuberechnen ihr Team"
              onclick={() => toggleFixed(booking.id, team)}
            >
              <svg
                aria-hidden="true"
                class="size-4"
                viewBox="0 0 24 24"
                fill={isFixed ? 'currentColor' : 'none'}
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
              </svg>
              Fixiert<span class="sr-only"> (Familie {booking.familyName})</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  {/if}
{/snippet}

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <div
      class="flex flex-wrap gap-x-5 border-b border-neutral-200"
      role="group"
      aria-label="Tag wählen"
    >
      {#each dates as option (option)}
        <button
          type="button"
          aria-pressed={date === option}
          onclick={() => selectDate(option)}
          class="-mb-px min-h-11 border-b-2 border-transparent px-1 py-2 text-sm font-semibold text-neutral-700 hover:text-brand-900 aria-[pressed=true]:border-[var(--color-dpsg-red)] aria-[pressed=true]:text-brand-900"
        >
          {formatShortDate(option)}
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn-secondary"
        disabled={!data || calculating}
        onclick={recalculate}
        title="Fixierte Termine behalten ihr Team"
      >
        {calculating ? 'Berechne …' : 'Neu berechnen'}
      </button>
      <button type="button" class="btn-secondary" disabled={!data} onclick={() => window.print()}>
        Drucken
      </button>
      <button
        type="button"
        class="btn-secondary"
        disabled={nikolausDispoStore.loading}
        onclick={reload}
      >
        {nikolausDispoStore.loading ? 'Lädt …' : 'Neu laden'}
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={!data || !dirty || saving || conflict || calculating}
        onclick={save}
      >
        {saving ? 'Speichert …' : 'Speichern'}
      </button>
    </div>
  </div>

  <StatusNotice message={notice?.text ?? null} kind={notice?.kind} class="print:hidden" />

  {#if !data && nikolausDispoStore.loading}
    <div role="status" aria-live="polite" class="surface p-6">
      <span class="sr-only">Dispo wird geladen …</span>
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    </div>
  {:else if !data}
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <h2 class="text-lg font-semibold text-brand-900">Die Dispo konnte nicht geladen werden</h2>
      <p class="mt-1 text-sm text-neutral-700">
        Bitte versuche es erneut. Falls das Problem bleibt, melde dich ab und wieder an.
      </p>
      <button type="button" class="btn-primary mt-4" onclick={() => fetchNikolausDispo(date)}>
        Erneut versuchen
      </button>
    </div>
  {:else if plan}
    <h2 class="hidden font-serif text-2xl font-semibold text-brand-900 print:block">
      Nikolaus-Dispo {formatShortDate(date)}
    </h2>

    <section aria-labelledby="dispo-summary-heading" class="text-sm text-neutral-800 print:hidden">
      <h2 id="dispo-summary-heading" class="sr-only">Überblick</h2>
      <p>
        <strong>{data.stops.length}</strong>
        {data.stops.length === 1 ? 'bestätigter Termin' : 'bestätigte Termine'} ·
        <strong>{data.teams.length}</strong>
        {data.teams.length === 1 ? 'Team' : 'Teams'} · Fahrzeit gesamt ca.
        <strong>{totals.drive} Min</strong>
        {#if totals.lateAfterSlot > 0}
          · <strong class="text-[var(--color-dpsg-red)]"
            >{totals.lateAfterSlot} nach Slot-Ende</strong
          >
        {/if}
        {#if dirty}· <span class="font-semibold text-[#8a4a00]">nicht gespeichert</span>{/if}
      </p>
      <p class="mt-1 text-neutral-700">
        Dauer pro Besuch: {data.minutesPerChild} Min pro Kind, mindestens {data.minVisitMinutes} Min.
        {data.travelSource === 'route'
          ? 'Fahrzeiten von OpenRouteService.'
          : 'Fahrzeiten nur aus der Luftlinie geschätzt – der Routendienst war nicht erreichbar.'}
      </p>
      {#if data.pendingCount > 0}
        <p class="mt-1 text-[#8a4a00]">
          {data.pendingCount}
          {data.pendingCount === 1
            ? 'Anmeldung ist noch nicht bestätigt und deshalb nicht eingeplant.'
            : 'Anmeldungen sind noch nicht bestätigt und deshalb nicht eingeplant.'}
        </p>
      {/if}
    </section>

    {#if changes.length > 0}
      <section
        aria-labelledby="dispo-changes-heading"
        class="border-l-4 border-[var(--color-dpsg-woelflinge)] py-1 pl-4 text-sm text-neutral-900 print:hidden"
      >
        <h2 id="dispo-changes-heading" class="font-semibold text-[#8a4a00]">
          Änderungen seit dem letzten Speichern
        </h2>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          {#each changes as change, i (i)}
            <li>{change}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.stops.length === 0}
      <p class="surface p-6 text-sm text-neutral-800">
        Für diesen Tag gibt es noch keine bestätigten Termine.
      </p>
    {:else}
      <div class="print:hidden">
        <NikolausDispoMap routes={mapRoutes} />
      </div>

      <div
        class="grid gap-x-8 gap-y-10 md:grid-cols-2 {data.teams.length >= 3
          ? 'xl:grid-cols-3'
          : ''} {data.teams.length >= 4 ? '2xl:grid-cols-4' : ''} print:block"
      >
        {#each plan.routes as route (route.team)}
          {@const ids = assignment[route.team] ?? []}
          <section
            aria-labelledby="dispo-team-{route.team}"
            class="team-column border-t-4 print:mb-6 print:break-inside-auto"
            style:border-top-color={teamColor.get(route.team)}
          >
            <div class="border-b border-neutral-200 py-3">
              <h2
                id="dispo-team-{route.team}"
                class="font-serif text-xl font-semibold text-brand-900"
              >
                Team {route.team}
              </h2>
              <p class="text-sm text-neutral-700">
                {route.stops.length}
                {route.stops.length === 1 ? 'Termin' : 'Termine'} · {routeChildren(ids)} Kinder
                {#if route.departure !== null && route.returnTime !== null}
                  <br />Abfahrt {base.name}
                  {minutesToTime(route.departure)} · zurück ca. {minutesToTime(route.returnTime)}
                  · Fahrzeit {Math.round(route.driveMinutes)} Min
                {/if}
              </p>
              {#if (data.members[route.team] ?? []).length > 0}
                <p class="mt-1 text-sm text-neutral-800">
                  {(data.members[route.team] ?? [])
                    .map((member) => `${member.role}: ${member.name}`)
                    .join(' · ')}
                </p>
              {/if}
            </div>
            {#if route.stops.length === 0}
              <p class="py-4 text-sm text-neutral-700">Keine Termine.</p>
            {:else}
              <ol class="divide-y divide-neutral-200 border-b border-neutral-200">
                {#each route.stops as planned, index (planned.id)}
                  {@render stopCard(planned, index, route.team)}
                {/each}
              </ol>
              <p class="flex flex-wrap gap-x-4 py-3 text-sm print:hidden">
                {#each mapsLinks(ids) as link, part (link)}
                  <a
                    class="font-semibold text-brand-800 underline"
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Route in Google Maps{mapsLinks(ids).length > 1 ? ` (Teil ${part + 1})` : ''}
                  </a>
                {/each}
                {#if !dirty && data.rows.length > 0}
                  <a
                    class="font-semibold text-brand-800 underline"
                    href="/leitendenbereich/nikolaus-fahrt?tag={encodeURIComponent(
                      date
                    )}&team={encodeURIComponent(route.team)}"
                  >
                    Fahrt-Ansicht
                  </a>
                {/if}
              </p>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  @media print {
    .team-column + .team-column {
      break-before: page;
    }
    .stop-card {
      break-inside: avoid;
    }
  }
</style>
