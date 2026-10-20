<script lang="ts">
  import { HELP_CONTACTS } from '../lib/helpContacts';
  import type { Notice } from '../lib/status';
  import { NIKOLAUS_NOTABLE_DELAY_MINUTES } from '../lib/nikolausConfig';
  import { mergeStops, formatTime } from '../lib/nikolausFahrtView';
  import { navigationLink } from '../lib/nikolausMaps';
  import FahrtStop from './nikolaus/FahrtStop.svelte';
  import FahrtOfflinePanel from './nikolaus/FahrtOfflinePanel.svelte';
  import FilterTabs from './ui/FilterTabs.svelte';

  import LoadState from './ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { ApiError } from '../lib/api';

  import { dateToLocalParts } from '../lib/nikolausConfig';
  import type { NikolausConfig } from '../lib/nikolausConfig';
  import {
    fetchNikolausSettings,
    nikolausSettingsStore,
  } from '../lib/nikolausSettingsStore.svelte';
  import { withBaked } from '../lib/storeView';
  import { timeToMinutes } from '../lib/nikolausDispo';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import {
    markNikolausVisit,
    expireNikolausRoute,
    fetchNikolausFahrt,
    nikolausFahrtStore,
  } from '../lib/nikolausFahrtStore.svelte';
  import type { StaffNikolausFahrtStop } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';

  /** How often the route is reloaded, to see changes of the Dispo and of the team mates. */
  const REFRESH_MS = 60_000;
  const TEAM_STORAGE_KEY = 'nikolaus-fahrt-team';

  interface Props {
    /** Settings baked into the page; refreshed from the API when online. */
    config: NikolausConfig;
  }
  let { config }: Props = $props();

  const settings = $derived(withBaked(nikolausSettingsStore, config).data ?? config);
  const snapshot = $derived(nikolausFahrtStore.snapshot);
  // A valid owner-bound snapshot can outlive the HTML's baked list of service days.
  const dates = $derived(
    [
      ...new Set([...settings.days.map((d) => d.date), ...(snapshot ? [snapshot.data.date] : [])]),
    ].sort()
  );

  let date = $state('');
  let team = $state<string | null>(null);
  /** Visits being saved, with the state they are changed to. */
  let pending = $state<Record<string, boolean>>({});
  let notice = $state<Notice | null>(null);
  /** The last background refresh failed, e.g. in a dead spot. */
  const offline = $derived(nikolausFahrtStore.offline);
  const lastSync = $derived(
    nikolausFahrtStore.lastSync ? new Date(nikolausFahrtStore.lastSync) : null
  );
  const queue = $derived(
    snapshot?.data.date === date && snapshot.team === team ? snapshot.queue : []
  );
  const queuedBookings = $derived(new Set(queue.map((entry) => entry.bookingId)));
  const pendingQueuedBookings = $derived(
    new Set(queue.filter((entry) => entry.status === 'pending').map((entry) => entry.bookingId))
  );
  const savedHere = $derived(snapshot?.data.date === date && snapshot.team === team);
  let now = $state(new Date());

  const data = $derived(nikolausFahrtStore.data?.date === date ? nikolausFahrtStore.data : null);
  const teamInfo = $derived(data?.teams.find((t) => t.name === team) ?? null);
  const stops = $derived(mergeStops(team ? (data?.routes[team] ?? []) : [], pending, queue));
  const next = $derived(stops.find((stop) => !stop.visited) ?? null);
  const visitedCount = $derived(stops.filter((stop) => stop.visited).length);
  const members = $derived(team ? (data?.members[team] ?? []) : []);

  /** Minutes the team is behind the planned arrival at the next visit, only on the day itself. */
  const delay = $derived.by(() => {
    // In the time zone of the Nikolausdienst, whatever the phone is set to
    const local = dateToLocalParts(now);
    if (!next?.plannedArrival || local.date !== date) return 0;
    return timeToMinutes(local.time) - timeToMinutes(next.plannedArrival);
  });

  function readStoredTeam(): string | null {
    try {
      return localStorage.getItem(TEAM_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeTeam(name: string): void {
    try {
      localStorage.setItem(TEAM_STORAGE_KEY, name);
    } catch {
      // Only a convenience: the team has to be chosen again next time
    }
  }

  function updateUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('tag', date);
    if (team) url.searchParams.set('team', team);
    else url.searchParams.delete('team');
    history.replaceState(history.state, '', url);
  }

  /** The day from the link, otherwise the next day of the Nikolausdienst; loads its route. */
  function chooseDate(param: string | null): void {
    const today = dateToLocalParts(new Date()).date;
    const next =
      (param && dates.includes(param) ? param : dates.find((d) => d >= today)) ?? dates[0] ?? '';
    if (next === date) return;
    date = next;
    if (date) void fetchNikolausFahrt(date);
  }

  $effect(() => {
    if (!snapshot || date === snapshot.data.date) return;
    const requested = new URLSearchParams(location.search).get('tag');
    if (requested ? requested !== snapshot.data.date : !offline) return;
    untrack(() => chooseDate(snapshot!.data.date));
  });

  /** Refresh the current route and synchronize any saved visit marks. */
  async function refresh(): Promise<void> {
    if (!date || Object.keys(pending).length > 0) return;
    await fetchNikolausFahrt(date, { silent: true });
  }

  $effect(() => {
    untrack(() => {
      const params = new URLSearchParams(window.location.search);
      team = params.get('team') ?? readStoredTeam();
      chooseDate(params.get('tag'));
      const chosen = date;
      // The days may have changed since the page was built; offline the baked ones stay
      void fetchNikolausSettings().then(() => {
        // Choose again unless someone picked a day meanwhile: a day added after the build may
        // be the one of the link or the next one. The route of the day first shown may already
        // have replaced the team, so the team of the link (or the last one) comes back as well.
        if (date === chosen || !dates.includes(date)) {
          chooseDate(params.get('tag'));
          if (date !== chosen) team = params.get('team') ?? readStoredTeam();
        }
      });
    });
  });

  // Reload regularly while the page is visible, and right away when it becomes visible again
  $effect(() => {
    const timer = setInterval(() => {
      now = new Date();
      void expireNikolausRoute();
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        now = new Date();
        void refresh();
      }
    };
    const onOnline = (): void => {
      now = new Date();
      void refresh();
    };
    const onOffline = (): void => {
      nikolausFahrtStore.offline = true;
    };
    const onStorage = (): void => {
      void expireNikolausRoute();
      void refresh();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  });

  $effect(() => {
    if (!snapshot) return;
    const timer = setTimeout(expireNikolausRoute, Math.max(0, snapshot.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  });

  // A team that does not exist on the chosen day is not selected. Only the server knows all
  // teams: a saved route holds just its own team and would drop the team of a link.
  $effect(() => {
    if (
      data &&
      nikolausFahrtStore.dataSource === 'server' &&
      team &&
      !data.teams.some((t) => t.name === team)
    ) {
      team = null;
    }
    // With a single team there is nothing to choose
    if (data && !team && data.teams.length === 1) team = data.teams[0].name;
  });

  /** Select the route date, update its URL, and load the corresponding route. */
  function selectDate(option: string): void {
    if (option === date) return;
    date = option;
    notice = null;
    updateUrl();
    void fetchNikolausFahrt(option);
  }

  function showForgotten(removed: boolean): void {
    notice = removed
      ? { text: 'Route und Markierungen sind von diesem Gerät gelöscht.', kind: 'success' }
      : {
          text: `Die Route ließ sich auf diesem Gerät nicht löschen, weil der Browser den Speicher sperrt. Lösche die Websitedaten in den Browser-Einstellungen oder schreib an ${HELP_CONTACTS.technik}.`,
          kind: 'error',
        };
  }

  /** Select a team and remember the selection for subsequent visits. */
  function selectTeam(name: string): void {
    team = name;
    notice = null;
    storeTeam(name);
    updateUrl();
    window.scrollTo({ top: 0 });
  }

  /** Submit a visit mark and keep its pending or error state visible to the team. */
  async function setVisited(stop: StaffNikolausFahrtStop, visited: boolean): Promise<void> {
    const id = stop.bookingId;
    if (id in pending) return;
    pending = { ...pending, [id]: visited };
    notice = null;
    try {
      await markNikolausVisit(date, team ?? '', stop, visited);
    } catch (error: unknown) {
      notice = {
        text:
          error instanceof ApiError && error.status === 404
            ? `Familie ${stop.familyName} ist nicht mehr in der Dispo. Bitte lade die Seite neu.`
            : error instanceof ApiError && error.status === 409
              ? `Familie ${stop.familyName} wurde inzwischen geändert. Bitte lade den aktuellen Stand und prüfe die Markierung.`
              : `Familie ${stop.familyName} konnte nicht gespeichert werden. Bitte prüfe die Verbindung und lade den aktuellen Stand.`,
        kind: 'error',
      };
    } finally {
      const rest = { ...pending };
      delete rest[id];
      pending = rest;
    }
  }
</script>

<div class="max-w-3xl space-y-6">
  {#if dates.length > 1}
    <FilterTabs
      label="Tag wählen"
      options={dates.map((date) => ({ value: date, label: formatShortDate(date) }))}
      value={date}
      onselect={selectDate}
      class="border-b border-neutral-200"
    />
  {/if}

  <!-- Outside the route, so it stays when removing the saved route leaves nothing to show -->
  <StatusNotice message={notice?.text ?? null} kind={notice?.kind} popup />

  <!-- With a route on hand, the offline notice tells about failed refreshes -->
  <LoadState
    {data}
    loading={nikolausFahrtStore.loading}
    error={data ? false : nikolausFahrtStore.error}
    loadingText="Route wird geladen …"
    onretry={() => void fetchNikolausFahrt(date)}
  >
    {#snippet skeleton()}
      <div class="surface p-6">
        <div class="skeleton-element h-6 w-56 rounded"></div>
        <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
      </div>
    {/snippet}
    {#snippet children(data)}
      <section aria-labelledby="fahrt-team-heading">
        <h2 id="fahrt-team-heading" class="text-sm font-semibold text-neutral-800">
          {team ? 'Team' : 'Welches Team seid ihr?'}
        </h2>
        <div
          class="mt-1 flex flex-wrap gap-x-6 border-b border-neutral-200"
          role="group"
          aria-labelledby="fahrt-team-heading"
        >
          {#each data.teams as option (option.name)}
            <button
              type="button"
              aria-pressed={team === option.name}
              onclick={() => selectTeam(option.name)}
              class="team-button -mb-px flex min-h-12 min-w-20 items-center gap-2 border-b-4 border-transparent px-1 text-base font-semibold"
              style:--team-color={option.color}
            >
              <span class="size-3 rounded-full" style:background={option.color} aria-hidden="true"
              ></span>
              Team {option.name}
            </button>
          {/each}
        </div>
      </section>

      {#if next && teamInfo}
        <ol class="list-none" aria-label="Nächster Besuch">
          <FahrtStop
            stop={next}
            index={stops.findIndex((stop) => stop.bookingId === next.bookingId)}
            color={teamInfo.color}
            isNext={true}
            busy={next.bookingId in pending || queuedBookings.has(next.bookingId)}
            queued={pendingQueuedBookings.has(next.bookingId)}
            onvisited={(visited) => void setVisited(next!, visited)}
          />
        </ol>
      {/if}

      <StatusNotice message={nikolausFahrtStore.storageError} kind="error" />

      <FahrtOfflinePanel {teamInfo} {savedHere} {offline} {refresh} onforget={showForgotten} />

      {#if !data.dispoSaved}
        <p class="surface p-6 text-sm text-neutral-800">
          Für diesen Tag ist noch keine Dispo gespeichert. Sobald die Routen in der
          <a class="font-semibold text-link underline" href="/leitendenbereich/nikolaus-dispo"
            >Dispo</a
          > gespeichert sind, erscheinen sie hier.
        </p>
      {:else if teamInfo}
        <section
          aria-labelledby="fahrt-route-heading"
          class="border-t-4"
          style:border-top-color={teamInfo.color}
        >
          <div class="py-3">
            <h2 id="fahrt-route-heading" class="font-serif text-xl font-semibold text-brand-900">
              Team {teamInfo.name} · {formatShortDate(date)}
            </h2>
            {#if members.length > 0}
              <p class="mt-1 text-sm text-neutral-800">
                {members.map((member) => `${member.role}: ${member.name}`).join(' · ')}
              </p>
            {/if}
            {#if stops.length > 0}
              <p class="mt-2 text-sm font-semibold tabular-nums text-neutral-900">
                {visitedCount} von {stops.length} besucht
              </p>
              <div
                class="mt-1 h-1.5 overflow-hidden bg-neutral-200"
                role="progressbar"
                aria-label="Besuche erledigt"
                aria-valuemin={0}
                aria-valuemax={stops.length}
                aria-valuenow={visitedCount}
              >
                <div
                  class="h-full transition-[width]"
                  style:background={teamInfo.color}
                  style:width="{(visitedCount / stops.length) * 100}%"
                ></div>
              </div>
            {/if}
          </div>

          <div class="space-y-3 text-sm">
            {#if data.droppedCount > 0 || data.unplannedCount > 0}
              <p class="border-l-4 border-warning py-1 pl-3 text-warning">
                Die Dispo ist nicht mehr ganz aktuell (Termine wurden verlegt, abgesagt oder sind
                neu dazugekommen). Bitte gebt der Dispo Bescheid.
              </p>
            {/if}
            {#if offline}
              <p class="border-l-4 border-neutral-400 py-1 pl-3 font-semibold text-neutral-800">
                Gerade keine Verbindung{lastSync ? ` – Stand ${formatTime(lastSync)} Uhr` : ''}.
              </p>
            {/if}

            {#if stops.length === 0}
              <p class="py-2 text-neutral-800">
                Team {teamInfo.name} hat an diesem Tag keine Termine.
              </p>
            {:else}
              {#if next && delay >= NIKOLAUS_NOTABLE_DELAY_MINUTES}
                <p class="border-l-4 border-danger py-1 pl-3 font-semibold text-danger">
                  Ihr seid ca. {delay} Min hinter dem Plan.
                </p>
              {/if}

              <p class="text-neutral-700">
                Hakt einen Besuch ab, wenn ihr wieder losfahrt – daraus berechnen wir den Familien
                nach euch, wann ihr voraussichtlich bei ihnen seid.
              </p>

              <ol class="divide-y divide-neutral-200 border-y border-neutral-200">
                {#each stops as stop, index (stop.bookingId)}
                  {#if stop.bookingId !== next?.bookingId}
                    <FahrtStop
                      {stop}
                      {index}
                      color={teamInfo.color}
                      isNext={stop.bookingId === next?.bookingId}
                      busy={stop.bookingId in pending || queuedBookings.has(stop.bookingId)}
                      queued={pendingQueuedBookings.has(stop.bookingId)}
                      onvisited={(visited) => void setVisited(stop, visited)}
                    />
                  {/if}
                {/each}
              </ol>

              {#if !next}
                <div class="border-l-4 border-success py-1 pl-4 text-neutral-900">
                  <p class="font-semibold">Alle Besuche erledigt – danke!</p>
                  <a
                    class="btn-primary mt-3"
                    href={navigationLink(`${data.base.lat},${data.base.lon}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Zurück zum {data.base.name}
                  </a>
                </div>
              {/if}
            {/if}
          </div>
        </section>
      {/if}
    {/snippet}
  </LoadState>
</div>

<style>
  .team-button {
    color: var(--color-neutral-700);
  }
  .team-button:hover {
    color: var(--color-brand-900);
  }
  .team-button[aria-pressed='true'] {
    border-bottom-color: var(--team-color);
    color: var(--color-brand-900);
  }
</style>
