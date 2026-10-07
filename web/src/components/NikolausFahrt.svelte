<script lang="ts">
  import FilterTabs from './ui/FilterTabs.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { ApiError } from '../lib/api';
  import { NIKOLAUS_SLOT_MINUTES, dateToLocalParts } from '../lib/nikolausConfig';
  import type { NikolausConfig } from '../lib/nikolausConfig';
  import {
    fetchNikolausSettings,
    nikolausSettingsStore,
  } from '../lib/nikolausSettingsStore.svelte';
  import { withBaked } from '../lib/storeView';
  import { minutesToTime, timeToMinutes } from '../lib/nikolausDispo';
  import { formatShortDate } from '../lib/nikolausAdmin';
  import {
    saveNikolausRoute,
    forgetNikolausRoute,
    markNikolausVisit,
    discardNikolausVisit,
    expireNikolausRoute,
    fetchNikolausFahrt,
    nikolausFahrtStore,
  } from '../lib/nikolausFahrtStore.svelte';
  import type { StaffNikolausFahrtStop } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';

  /** How often the route is reloaded, to see changes of the Dispo and of the team mates. */
  const REFRESH_MS = 60_000;
  /** From this delay on, the team is told that it is behind the plan. */
  const NOTABLE_DELAY_MINUTES = 10;
  const TEAM_STORAGE_KEY = 'nikolaus-fahrt-team';

  interface Props {
    /** Settings baked into the page; refreshed from the API when online. */
    config: NikolausConfig;
  }
  let { config }: Props = $props();

  const settings = $derived(withBaked(nikolausSettingsStore, config).data ?? config);
  const dates = $derived(settings.days.map((d) => d.date).sort());

  interface Notice {
    text: string;
    kind: 'success' | 'warning' | 'error';
  }

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
  const snapshot = $derived(nikolausFahrtStore.snapshot);
  const queue = $derived(
    snapshot?.data.date === date && snapshot.team === team ? snapshot.queue : []
  );
  const savedHere = $derived(snapshot?.data.date === date && snapshot.team === team);
  let now = $state(new Date());

  const data = $derived(nikolausFahrtStore.data?.date === date ? nikolausFahrtStore.data : null);
  const teamInfo = $derived(data?.teams.find((t) => t.name === team) ?? null);
  const stops = $derived(
    (team ? (data?.routes[team] ?? []) : []).map((stop) =>
      stop.bookingId in pending
        ? { ...stop, visited: pending[stop.bookingId] }
        : queue.find((entry) => entry.bookingId === stop.bookingId && entry.status === 'pending')
          ? {
              ...stop,
              visited: queue.find((entry) => entry.bookingId === stop.bookingId)!.visited,
              visitedAt: '',
            }
          : stop
    )
  );
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
    date =
      (param && dates.includes(param) ? param : dates.find((d) => d >= today)) ?? dates[0] ?? '';
    if (date) void fetchNikolausFahrt(date);
  }

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
      // The days may have changed since the page was built; offline the baked ones stay
      void fetchNikolausSettings().then(() => {
        if (!date) chooseDate(params.get('tag'));
      });
    });
  });

  // Reload regularly while the page is visible, and right away when it becomes visible again
  $effect(() => {
    const timer = setInterval(() => {
      now = new Date();
      expireNikolausRoute();
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        now = new Date();
        void refresh();
      }
    };
    const onOffline = (): void => {
      nikolausFahrtStore.offline = true;
    };
    const onStorage = (): void => {
      expireNikolausRoute();
      void refresh();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  });

  $effect(() => {
    if (!snapshot) return;
    const timer = setTimeout(expireNikolausRoute, Math.max(0, snapshot.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  });

  // A team that does not exist on the chosen day is not selected
  $effect(() => {
    if (data && team && !data.teams.some((t) => t.name === team)) team = null;
  });

  /** Select the route date, update its URL, and load the corresponding route. */
  function selectDate(option: string): void {
    if (option === date) return;
    date = option;
    notice = null;
    updateUrl();
    void fetchNikolausFahrt(option);
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

  function mapsPoint(point: {
    location: StaffNikolausFahrtStop['location'];
    street: string;
    postalCode: string;
    city: string;
  }): string {
    return point.location && !point.location.approximate
      ? `${point.location.lat},${point.location.lon}`
      : `${point.street}, ${point.postalCode} ${point.city}`;
  }

  /** Google Maps navigation from the current position to the given destination. */
  function navigationLink(destination: string): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }

  function slotLabel(slotKey: string): string {
    const time = slotKey.split('T')[1] ?? '';
    return time ? `${time}–${minutesToTime(timeToMinutes(time) + NIKOLAUS_SLOT_MINUTES)}` : '';
  }

  function formatTime(instant: Date): string {
    return instant.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
</script>

{#snippet details(stop: StaffNikolausFahrtStop)}
  <p class="text-neutral-800">
    {stop.childrenCount}
    {stop.childrenCount === 1 ? 'Kind' : 'Kinder'}
    {#if stop.withKrampus}· <strong>mit Krampus</strong>{/if}
  </p>
  {#if stop.hidingPlace}
    <p class="mt-2 border-l-4 border-[var(--color-brand-300)] py-0.5 pl-3 text-neutral-900">
      <span class="font-semibold">Versteck:</span>
      {stop.hidingPlace}
    </p>
  {/if}
  {#if stop.addressNotes}
    <p class="mt-2"><span class="font-semibold">Zur Adresse:</span> {stop.addressNotes}</p>
  {/if}
  {#if stop.notes}
    <p class="mt-1"><span class="font-semibold">Bemerkungen:</span> {stop.notes}</p>
  {/if}
  {#if stop.moved}
    <p class="mt-1 font-semibold text-warning">
      <span aria-hidden="true">⚠</span> Seit der Dispo auf {stop.slotKey.split('T')[1]} Uhr verlegt
    </p>
  {/if}
  {#if !stop.location}
    <p class="mt-1 text-warning">Adresse nicht auf der Karte gefunden – bitte genau prüfen</p>
  {:else if stop.location.approximate}
    <p class="mt-1 text-warning">Nur der Ort wurde gefunden – bitte genau prüfen</p>
  {/if}
{/snippet}

{#snippet actions(stop: StaffNikolausFahrtStop, primary: boolean)}
  <div class="mt-4 flex flex-wrap gap-2">
    <a
      class="btn-secondary min-h-12"
      href={navigationLink(mapsPoint(stop))}
      target="_blank"
      rel="noopener noreferrer"
    >
      Navigation<span class="sr-only"> zu Familie {stop.familyName}</span>
    </a>
    {#if stop.phone}
      <a class="btn-secondary min-h-12" href="tel:{stop.phone}">
        Anrufen<span class="sr-only"> bei Familie {stop.familyName}</span>
      </a>
    {/if}
    <button
      type="button"
      class="{primary ? 'btn-primary' : 'btn-secondary'} min-h-12 grow sm:grow-0 sm:px-6"
      disabled={stop.bookingId in pending ||
        queue.some((entry) => entry.bookingId === stop.bookingId)}
      onclick={() => setVisited(stop, true)}
    >
      <span aria-hidden="true">✓</span> Besucht<span class="sr-only">
        (Familie {stop.familyName})</span
      >
    </button>
  </div>
{/snippet}

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

  {#if !data && nikolausFahrtStore.loading}
    <div role="status" aria-live="polite" class="surface p-6">
      <span class="sr-only">Route wird geladen …</span>
      <div class="skeleton-element h-6 w-56 rounded"></div>
      <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    </div>
  {:else if !data}
    <div role="alert" class="surface p-6 border-l-4! border-l-danger!">
      <h2 class="text-lg font-semibold text-brand-900">Die Route konnte nicht geladen werden</h2>
      <p class="mt-1 text-sm text-neutral-700">
        Bitte prüfe die Verbindung und versuche es erneut. Falls das Problem bleibt, melde dich ab
        und wieder an.
      </p>
      <ActionButton
        variant="primary"
        type="button"
        class="mt-4"
        onclick={() => fetchNikolausFahrt(date)}
      >
        Erneut versuchen
      </ActionButton>
    </div>
  {:else}
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

    <StatusNotice message={notice?.text ?? null} kind={notice?.kind} popup />
    <StatusNotice message={nikolausFahrtStore.storageError} kind="error" />

    {#if teamInfo}
      <section
        class="rounded-md border border-neutral-200 bg-surface p-3 text-sm"
        aria-label="Route auf diesem Gerät"
      >
        {#if savedHere && snapshot}
          <p>
            Diese Teamroute ist auf diesem Gerät bis {formatTime(new Date(snapshot.expiresAt))} Uhr gespeichert
            (maximal zwölf Stunden).
          </p>
          <p class="mt-1 text-neutral-700">
            Bitte die Seite während der Fahrt geöffnet lassen. Navigation in Karten-Apps benötigt
            gegebenenfalls eine eigene Offline-Karte.
          </p>
          <ActionButton
            variant="secondary"
            type="button"
            class="mt-2"
            onclick={() => {
              if (
                !snapshot.queue.length ||
                window.confirm('Lokale Route und ausstehende Markierungen unwiderruflich löschen?')
              )
                void forgetNikolausRoute();
            }}>Lokale Route und Markierungen löschen</ActionButton
          >
        {:else}
          <p>
            Speichert eure Teamroute vor der Fahrt für Funklöcher. Familiendaten bleiben maximal
            zwölf Stunden auf diesem Gerät; verwendet dafür ein eigenes oder ein Teamgerät.
          </p>
          <ActionButton
            variant="secondary"
            type="button"
            class="mt-2"
            disabled={offline}
            onclick={() => saveNikolausRoute(teamInfo.name)}
            >Route für Funklöcher speichern</ActionButton
          >
        {/if}
      </section>
    {/if}
    {#if snapshot?.queue.length}
      <section
        class="rounded-md border border-[#f5cf9f] bg-warning-soft p-3 text-sm text-warning"
        aria-label="Ausstehende Besuchsmarkierungen"
        aria-live="polite"
      >
        <p class="font-semibold">
          {nikolausFahrtStore.syncing
            ? 'Markierungen werden abgeglichen …'
            : `${snapshot.queue.length} Markierung(en) noch nicht bestätigt`}
        </p>
        <p>
          Solange eine Markierung aussteht, sehen Familien und Disposition sie noch nicht
          zuverlässig. Besuchszeiten werden beim Serverabgleich gesetzt.
        </p>
        <ul class="mt-2 space-y-2">
          {#each snapshot.queue as entry (entry.operationId)}
            <li>
              {snapshot.data.routes[snapshot.team]?.find(
                (stop) => stop.bookingId === entry.bookingId
              )?.familyName ?? 'Besuch'}:
              {entry.visited ? 'besucht' : 'zurücksetzen'} –
              {entry.status === 'conflict'
                ? 'Konflikt: Besuch oder Planung inzwischen geändert. Aktuellen Stand prüfen und bei Bedarf neu markieren.'
                : 'wartet auf Verbindung und Bestätigung'}
              <button
                type="button"
                class="ml-2 font-semibold underline"
                onclick={() => {
                  if (
                    window.confirm(
                      'Diese lokale Markierung verwerfen? Ein möglicherweise bereits gespeicherter Serverstand bleibt bestehen.'
                    )
                  )
                    void discardNikolausVisit(entry.operationId);
                }}>Markierung verwerfen</button
              >
            </li>
          {/each}
        </ul>
        <ActionButton
          variant="secondary"
          type="button"
          class="mt-2"
          disabled={nikolausFahrtStore.syncing}
          onclick={refresh}>Jetzt abgleichen</ActionButton
        >
      </section>
    {/if}

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
              Die Dispo ist nicht mehr ganz aktuell (Termine wurden verlegt, abgesagt oder sind neu
              dazugekommen). Bitte gebt der Disposition Bescheid.
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
            {#if next && delay >= NOTABLE_DELAY_MINUTES}
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
                <li>
                  {#if stop.visited}
                    <div class="flex items-center gap-3 py-2 text-neutral-700">
                      <span
                        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-neutral-50"
                        aria-hidden="true">✓</span
                      >
                      <p class="min-w-0 flex-1">
                        <span class="font-semibold text-neutral-900">Familie {stop.familyName}</span
                        >
                        <span class="block text-xs">
                          {queue.some(
                            (entry) =>
                              entry.bookingId === stop.bookingId && entry.status === 'pending'
                          )
                            ? 'Besucht – noch nicht bestätigt'
                            : 'Besucht'}{stop.visitedAt ? ` um ${stop.visitedAt} Uhr` : ''}
                        </span>
                      </p>
                      <ActionButton
                        variant="secondary"
                        type="button"
                        disabled={stop.bookingId in pending ||
                          queue.some((entry) => entry.bookingId === stop.bookingId)}
                        onclick={() => setVisited(stop, false)}
                      >
                        Rückgängig<span class="sr-only"> (Familie {stop.familyName})</span>
                      </ActionButton>
                    </div>
                  {:else if stop.bookingId === next?.bookingId}
                    <article
                      aria-label="Als Nächstes: Familie {stop.familyName}"
                      class="border-l-4 py-4 pl-4"
                      style:border-left-color={teamInfo.color}
                    >
                      <p class="text-sm font-semibold" style:color={teamInfo.color}>
                        Als Nächstes · {index + 1}. Besuch
                      </p>
                      <p class="mt-1 flex flex-wrap items-baseline gap-x-2">
                        <span class="text-xl font-semibold tabular-nums text-brand-900"
                          >ca. {stop.plannedArrival} Uhr</span
                        >
                        <span class="text-neutral-700">Slot {slotLabel(stop.slotKey)}</span>
                      </p>
                      <p class="text-lg font-semibold text-neutral-900">
                        Familie {stop.familyName}
                      </p>
                      <p class="text-base text-neutral-800">
                        {stop.street}, {stop.postalCode}
                        {stop.city}
                      </p>
                      <div class="mt-2 text-base">{@render details(stop)}</div>
                      {@render actions(stop, true)}
                    </article>
                  {:else}
                    <details class="group">
                      <summary class="flex min-h-12 cursor-pointer items-start gap-3 py-3">
                        <span
                          class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                          style:background={teamInfo.color}
                          aria-hidden="true">{index + 1}</span
                        >
                        <span class="min-w-0 flex-1">
                          <span class="font-semibold tabular-nums text-brand-900"
                            >ca. {stop.plannedArrival}</span
                          >
                          ·
                          <span class="font-semibold text-neutral-900"
                            >Familie {stop.familyName}</span
                          >
                          <span class="block text-neutral-700">{stop.street}, {stop.city}</span>
                        </span>
                        <span
                          class="mt-1 text-neutral-700 transition-transform group-open:rotate-180"
                          aria-hidden="true">▾</span
                        >
                      </summary>
                      <div class="pb-4 pl-10">
                        <p class="text-neutral-700">Slot {slotLabel(stop.slotKey)}</p>
                        {@render details(stop)}
                        {@render actions(stop, false)}
                      </div>
                    </details>
                  {/if}
                </li>
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
  {/if}
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
  summary::-webkit-details-marker {
    display: none;
  }
  summary {
    list-style: none;
  }
  summary:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
