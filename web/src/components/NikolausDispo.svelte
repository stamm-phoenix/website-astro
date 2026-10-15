<script lang="ts">
  import { createRoutePaths } from '../lib/routePaths.svelte';
  import DispoTeamColumn from './nikolaus/DispoTeamColumn.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';
  import PlanToolbar from './nikolaus/PlanToolbar.svelte';

  import { createPlanEditor } from '../lib/planEditor.svelte';
  import LoadState from './ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { confirmAction } from '../lib/confirm';
  import { dateToLocalParts } from '../lib/nikolausConfig';
  import type { NikolausConfig } from '../lib/nikolausConfig';
  import {
    fetchNikolausSettings,
    nikolausSettingsStore,
  } from '../lib/nikolausSettingsStore.svelte';
  import { withBaked } from '../lib/storeView';
  import { evaluateDispo, minutesToTime, moveStop, solveDispo } from '../lib/nikolausDispo';
  import type { DispoAssignment } from '../lib/nikolausDispo';
  import { fetchNikolausDispo, nikolausDispoStore } from '../lib/nikolausDispoStore.svelte';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import type { StaffNikolausDispoData, StaffNikolausDispoSaved } from '../lib/types';
  import { toProblem, restoreDispoDraft } from '../lib/nikolausDispoPlan';

  import NikolausDispoMap from './NikolausDispoMap.svelte';
  import type { DispoMapRoute } from './NikolausDispoMap.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    /** Settings baked into the page; refreshed from the API. */
    config: NikolausConfig;
  }
  let { config }: Props = $props();

  const settings = $derived(withBaked(nikolausSettingsStore, config).data ?? config);
  const base = $derived(settings.area.base);
  const dates = $derived(settings.days.map((d) => d.date).sort());

  let date = $state('');
  let assignment = $state<DispoAssignment>({});
  /** Team assignments set by hand (booking ID → team); kept when recalculating. */
  let fixed = $state<Record<string, string>>({});
  let dirty = $state(false);
  let calculating = $state(false);
  /** Hints about changes since the Dispo was saved. */
  let changes = $state<string[]>([]);

  const editor = createPlanEditor({
    dirty: () => dirty,
    field: 'entries',
    conflictMessage:
      'Die Dispo wurde inzwischen von jemand anderem geändert. Bitte neu laden – deine Änderungen gehen dabei verloren.',
    saveError:
      'Die Dispo wurde nicht gespeichert. Dein Entwurf ist noch da. Tippe noch einmal auf „Speichern“.',
  });

  const data = $derived(nikolausDispoStore.data?.date === date ? nikolausDispoStore.data : null);
  const stopsById = $derived(new Map((data?.stops ?? []).map((stop) => [stop.id, stop])));
  const teamColor = $derived(new Map((data?.teams ?? []).map((t) => [t.name, t.color])));

  const problem = $derived(data ? toProblem(data) : null);
  const plan = $derived(problem ? evaluateDispo(problem, assignment) : null);

  const totals = $derived.by(() => {
    const stops = plan?.routes.flatMap((route) => route.stops) ?? [];
    return {
      drive: Math.round(plan?.routes.reduce((sum, route) => sum + route.driveMinutes, 0) ?? 0),
      lateAfterSlot: stops.filter((stop) => stop.lateAfterSlot > 0).length,
    };
  });

  const routePaths = createRoutePaths(() => ({ date: data?.date, assignment }));

  const mapRoutes = $derived.by((): DispoMapRoute[] =>
    (plan?.routes ?? []).map((route) => ({
      team: route.team,
      color: teamColor.get(route.team) ?? '#003056',
      path: routePaths.path(date, route.team, assignment[route.team]),
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

  /** Builds the working state from the loaded data: the saved Dispo or a new suggestion. */
  function initFrom(source: StaffNikolausDispoData): void {
    const target = toProblem(source);
    changes = [];
    editor.state.conflict = false;

    if (source.rows.length === 0) {
      fixed = {};
      assignment = solveDispo(target);
      dirty = source.stops.length > 0;
      editor.state.notice =
        source.stops.length > 0
          ? { text: 'Vorschlag berechnet – noch nicht gespeichert.', kind: 'warning' }
          : null;
      return;
    }

    const restored = restoreDispoDraft(source);
    assignment = restored.assignment;
    fixed = restored.fixed;
    changes = restored.changes;
    dirty = changes.length > 0;
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
      const choose = (): void => {
        const today = dateToLocalParts(new Date()).date;
        date =
          (param && dates.includes(param) ? param : dates.find((d) => d >= today)) ??
          dates[0] ??
          '';
        if (date) void fetchNikolausDispo(date);
      };
      choose();
      // The days may have changed since the page was built
      void fetchNikolausSettings().then(() => {
        // Choose again if the day is not (or no longer) a day of the Nikolausdienst
        if (!dates.includes(date)) choose();
      });
    });
  });

  async function selectDate(next: string): Promise<void> {
    if (next === date) return;
    if (
      dirty &&
      !(await confirmAction({
        title: 'Tag wechseln?',
        message: 'Die Änderungen an der Dispo sind noch nicht gespeichert. Trotzdem wechseln?',
        confirmLabel: 'Änderungen verwerfen',
      }))
    ) {
      return;
    }
    date = next;
    dirty = false;
    editor.state.notice = null;
    const url = new URL(window.location.href);
    url.searchParams.set('tag', next);
    history.replaceState(history.state, '', url);
    void fetchNikolausDispo(next);
  }

  async function reload(): Promise<void> {
    if (
      !(await editor.confirmReload(
        'Die Änderungen an der Dispo sind noch nicht gespeichert. Trotzdem neu laden?'
      ))
    )
      return;
    dirty = false;
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
      editor.state.notice = { text: 'Neu berechnet – noch nicht gespeichert.', kind: 'warning' };
    }, 30);
  }

  function changeTeam(id: string, team: string): void {
    if (!problem) return;
    assignment = moveStop(problem, $state.snapshot(assignment), id, team);
    fixed = { ...fixed, [id]: team };
    dirty = true;
    editor.state.notice = null;
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
    const entries = plan.routes.flatMap((route) =>
      route.stops.map((stop, i) => ({
        bookingId: stop.id,
        team: route.team,
        order: i + 1,
        plannedArrival: minutesToTime(stop.start),
        fixed: fixed[stop.id] === route.team,
      }))
    );
    await editor.save(async () => {
      const saved = await sendApi<StaffNikolausDispoSaved>(
        'PUT',
        `/intern/pflege/nikolaus-dispo?date=${encodeURIComponent(date)}`,
        { version: data.version, entries }
      );
      nikolausDispoStore.data = { ...data, rows: saved.rows, version: saved.version };
    }, 'Dispo gespeichert.');
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
    <FilterTabs
      label="Tag wählen"
      options={dates.map((date) => ({ value: date, label: formatShortDate(date) }))}
      value={date}
      onselect={selectDate}
      class="border-b border-neutral-200"
    />
    <PlanToolbar
      loading={nikolausDispoStore.loading}
      saveDisabled={!data || !dirty || editor.state.saving || editor.state.conflict || calculating}
      saving={editor.state.saving}
      title="Fixierte Termine behalten ihr Team"
      onrecalculate={recalculate}
      onreload={reload}
      onsave={save}
      recalculateDisabled={!data || calculating}
      printDisabled={!data}
      {calculating}
      class="items-center"
    />
  </div>

  <StatusNotice
    message={editor.state.notice?.text ?? null}
    kind={editor.state.notice?.kind}
    class="print:hidden"
  />

  <LoadState
    {data}
    loading={nikolausDispoStore.loading}
    error={nikolausDispoStore.error}
    loadingText="Dispo wird geladen …"
    onretry={() => void reload()}
  >
    {#snippet skeleton()}
      <div class="surface p-6">
        <div class="skeleton-element h-6 w-56 rounded"></div>
        <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
      </div>
    {/snippet}
    {#snippet children(data)}
      {#if plan}
        <h2 class="hidden font-serif text-2xl font-semibold text-brand-900 print:block">
          Nikolaus-Dispo {formatShortDate(date)}
        </h2>

        <section
          aria-labelledby="dispo-summary-heading"
          class="text-sm text-neutral-800 print:hidden"
        >
          <h2 id="dispo-summary-heading" class="sr-only">Überblick</h2>
          <p>
            <strong>{data.stops.length}</strong>
            {data.stops.length === 1 ? 'bestätigter Termin' : 'bestätigte Termine'} ·
            <strong>{data.teams.length}</strong>
            {data.teams.length === 1 ? 'Team' : 'Teams'} · Fahrzeit gesamt ca.
            <strong>{totals.drive} Min</strong>
            {#if totals.lateAfterSlot > 0}
              · <strong class="text-danger">{totals.lateAfterSlot} nach Slot-Ende</strong>
            {/if}
            {#if dirty}· <span class="font-semibold text-warning">nicht gespeichert</span>{/if}
          </p>
          <p class="mt-1 text-neutral-700">
            Dauer pro Besuch: {data.minutesPerChild} Min pro Kind, mindestens {data.minVisitMinutes} Min.
            {data.travelSource === 'route'
              ? 'Fahrzeiten von OpenRouteService.'
              : 'Fahrzeiten nur aus der Luftlinie geschätzt – der Routendienst war nicht erreichbar.'}
          </p>
          {#if data.pendingCount > 0}
            <p class="mt-1 text-warning">
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
            class="border-l-4 border-warning py-1 pl-4 text-sm text-neutral-900 print:hidden"
          >
            <h2 id="dispo-changes-heading" class="font-semibold text-warning">
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
            <NikolausDispoMap routes={mapRoutes} {base} />
          </div>

          <div
            class="grid gap-x-8 gap-y-10 md:grid-cols-2 {data.teams.length >= 3
              ? 'xl:grid-cols-3'
              : ''} {data.teams.length >= 4 ? '2xl:grid-cols-4' : ''} print:block"
          >
            {#each plan.routes as route (route.team)}
              {@const ids = assignment[route.team] ?? []}
              <DispoTeamColumn
                {route}
                {ids}
                {data}
                color={teamColor.get(route.team)}
                {base}
                {fixed}
                {dirty}
                {date}
                onteam={changeTeam}
                onpin={toggleFixed}
              />
            {/each}
          </div>
        {/if}
      {/if}
    {/snippet}
  </LoadState>
</div>
