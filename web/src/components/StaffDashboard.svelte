<script lang="ts">
  import { taskHasAssignee, taskAssigneeNames } from '../../../api/lib/aufgaben-zuordnung';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { aufgabenStore, loadTasks, loadTaskUsers } from '../lib/aufgabenStore.svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import {
    favoritesStore,
    favoriteToggle,
    loadFavorites,
    toggleFavorite,
  } from '../lib/staffFavoritesStore.svelte';
  import { longPress } from '../lib/longPress';
  import {
    STAFF_MODULES,
    NIKOLAUS_CONTROL_MODULE,
    NIKOLAUS_MODULES,
    STAFF_FAVORITE_PATHS,
    type StaffModule,
  } from '../lib/staffModules';
  import { loadRecent, recentStore } from '../lib/staffRecentStore.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { yourStaffModules } from '../lib/staffSearch';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatDate, formatEventRange } from '../lib/campflowFields';
  import { dueLabel, dueSoon, pendingTask } from '../lib/aufgabenView';
  import { localDate } from '../lib/dateUtils';
  import { KJR_ABGABE_MONATE, kjrRestzeit, offeneKjrFristen } from '../lib/kjrFristen';
  import LoadState from './ui/LoadState.svelte';

  /** Entries per area; the link next to the heading leads to the full list. */
  const CARD_LIMIT = 3;
  /** Tiles of „Deine Bereiche“: two rows of four on a phone. */
  const TILE_LIMIT = 8;
  const modules = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE];
  const tileGrid = 'mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8';
  // Modules of the Nikolausdienst only while they are switched on (Steuerung always)
  const allModules = $derived([
    ...modules,
    ...(nikolausStatusStore.data?.staffActive ? NIKOLAUS_MODULES : []),
  ]);
  const tasks = $derived(aufgabenStore.data);
  const users = $derived(aufgabenStore.users);
  const tasksError = $derived(aufgabenStore.error);
  const tasksLoading = $derived(aufgabenStore.loading);
  const eventsLoading = $derived(campflowEventsStore.loading);
  const favoriteModules = $derived(
    modules.filter((module) => favoritesStore.modules.includes(module.href))
  );
  // Recently used areas fill up the tiles after the favorites
  const recentModules = $derived(
    yourStaffModules(
      [],
      recentStore.modules,
      allModules.filter((module) => !favoritesStore.modules.includes(module.href)),
      Math.max(0, TILE_LIMIT - favoriteModules.length)
    )
  );
  const upcoming = $derived(
    (campflowEventsStore.data ?? [])
      .filter(
        (event) =>
          !event.archived && event.start_date && event.start_date.slice(0, 10) >= localDate()
      )
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  );
  const fristen = $derived(offeneKjrFristen(campflowEventsStore.data ?? [], localDate()));
  const openTasks = $derived(
    (tasks?.tasks ?? [])
      .filter((task) => task.state === 'offen')
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.title.localeCompare(b.title, 'de')
      )
  );
  const ownTasks = $derived(openTasks.filter((task) => taskHasAssignee(task, tasks?.login)));
  const pendingCount = $derived(tasks?.tasks.filter(pendingTask).length ?? 0);

  // A card is collapsed into the line „Nichts offen“ only once its data has loaded and is empty,
  // so an empty area is never mistaken for one that failed to load.
  const eventsEmpty = $derived(
    !eventsLoading && !campflowEventsStore.error && upcoming.length === 0
  );
  const fristenEmpty = $derived(
    !eventsLoading && !campflowEventsStore.error && fristen.length === 0
  );
  const tasksEmpty = $derived(!tasksLoading && !tasksError && openTasks.length === 0);
  const cardCount = $derived(
    [eventsEmpty, tasksEmpty, fristenEmpty].filter((empty) => !empty).length
  );
  // Side by side once there is room; stacked areas are divided by lines instead
  const gridColumns = $derived(
    cardCount === 3
      ? 'xl:grid-cols-3 xl:divide-x xl:divide-y-0'
      : cardCount === 2
        ? 'md:grid-cols-2 md:divide-x md:divide-y-0'
        : ''
  );

  onMount(() => {
    void loadTaskUsers();
    void fetchPrincipal();
    void fetchCampflowEvents();
    void loadTasks();
    void loadRecent();
    void fetchNikolausStatus();
  });
  function reloadFavorites(): void {
    const userId = authStore.principal?.userId;
    if (userId) void loadFavorites(userId, STAFF_FAVORITE_PATHS);
  }
  $effect(() => {
    if (authStore.principal) untrack(reloadFavorites);
  });
  // The favorites belong to the account, so they wait for it; a failed check of the login is
  // shown like a failed load, and retrying checks it again (the effect above then loads them)
  const favoritesLoading = $derived(favoritesStore.loading || authStore.loading);
  const favoritesError = $derived(
    favoritesStore.loadError ??
      (authStore.error && !authStore.principal
        ? 'Deine Favoriten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
        : null)
  );
  function retryFavorites(): void {
    if (authStore.principal) reloadFavorites();
    else void fetchPrincipal();
  }
</script>

{#snippet card(id: string, title: string, href: string, linkLabel: string, body: Snippet)}
  <section aria-labelledby={id} class="min-w-0 p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <h3 {id} class="text-base font-semibold text-brand-900">{title}</h3>
      <a {href} class="text-link inline-flex min-h-11 items-center text-sm">{linkLabel}</a>
    </div>
    {@render body()}
  </section>
{/snippet}

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

{#snippet tile(module: StaffModule, favorite: boolean)}
  <li class="group relative min-w-0">
    <a
      use:longPress={favoriteToggle(module)}
      href={module.href}
      data-astro-reload={module.reload || undefined}
      class="staff-tile flex h-full min-h-20 flex-col items-center justify-center gap-1.5 border border-neutral-300 bg-surface px-1 py-2 text-center text-[0.8rem] leading-tight font-semibold text-brand-900 no-underline hover:border-brand-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 sm:text-sm"
    >
      <svg
        class="size-6 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d={module.icon} /></svg
      >
      <span class="max-w-full break-words hyphens-auto">{@render moduleTitle(module)}</span>
    </a>
    {#if favorite}
      <!-- With a mouse on hover; on a touch screen a long press on the tile removes it -->
      <button
        type="button"
        class="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-neutral-300 bg-surface text-brand-900 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:border-brand-900 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:not-focus-visible:sr-only pointer-coarse:focus-visible:size-11"
        aria-label="{module.title} aus deinen Favoriten entfernen"
        title="Aus deinen Favoriten entfernen"
        onclick={() => toggleFavorite(module.href, module.title)}
      >
        <svg
          aria-hidden="true"
          class="size-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M6 12h12" /></svg
        >
      </button>
    {/if}
  </li>
{/snippet}

{#snippet favoritesHint()}
  <span class="pointer-coarse:hidden"
    >Zeig mit der Maus auf einen Bereich und klick auf den Stern, um ihn zum Favoriten zu machen;
    das Minus an einer Kachel entfernt ihn wieder.</span
  ><span class="hidden pointer-coarse:inline"
    >Tippe lange auf einen Bereich, um ihn zum Favoriten zu machen oder wieder zu entfernen.</span
  >
{/snippet}

{#snippet check()}
  <svg
    class="size-4 shrink-0 text-success"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg
  >
{/snippet}

{#snippet more(count: number)}
  {#if count > CARD_LIMIT}
    <p class="pt-2 text-sm text-neutral-700">und {count - CARD_LIMIT} weitere</p>
  {/if}
{/snippet}

{#snippet eventsBody()}
  <LoadState
    data={campflowEventsStore.data}
    loading={eventsLoading}
    error={campflowEventsStore.error}
    loadingText="Aktionen werden geladen …"
    onretry={() => fetchCampflowEvents({ force: true })}
  >
    {#snippet skeleton()}
      <p aria-hidden="true" class="mt-2 text-sm text-neutral-700">Aktionen werden geladen …</p>
    {/snippet}
    <ul class="mt-1 divide-y divide-neutral-200">
      {#each upcoming.slice(0, CARD_LIMIT) as event (event.id)}<li class="py-2">
          <a
            class="text-link block truncate font-semibold"
            href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(event.id)}"
            title={event.title}>{event.title}</a
          >
          <p class="text-sm text-neutral-700">{formatEventRange(event)}</p>
        </li>{/each}
    </ul>
    {@render more(upcoming.length)}
  </LoadState>
{/snippet}

{#snippet tasksBody()}
  <LoadState
    data={tasks}
    loading={tasksLoading}
    error={tasksError}
    loadingText="Aufgaben werden geladen …"
    onretry={loadTasks}
  >
    {#snippet skeleton()}
      <p aria-hidden="true" class="mt-2 text-sm text-neutral-700">Aufgaben werden geladen …</p>
    {/snippet}
    <p class="text-sm text-neutral-700">
      {ownTasks.length} dir zugewiesen · {openTasks.length} offen
    </p>
    {#if pendingCount > 0}<a
        class="text-link text-sm font-semibold"
        href="/leitendenbereich/aufgaben/vorschlaege"
        >{pendingCount} {pendingCount === 1 ? 'Vorschlag' : 'Vorschläge'} prüfen</a
      >{/if}
    {@const shown = ownTasks.length ? ownTasks : openTasks}
    <ul class="mt-1 divide-y divide-neutral-200">
      {#each shown.slice(0, CARD_LIMIT) as task (task.id)}
        <li class="py-2">
          <a
            href="/leitendenbereich/aufgaben#aufgabe-{task.id}"
            class="text-link block truncate font-semibold"
            title={task.title}>{task.title}</a
          >
          <p class="text-sm text-neutral-700 break-words">
            {taskAssigneeNames(task, users)} ·
            <span class:text-warning={dueSoon(task)}>{dueLabel(task)}</span>
          </p>
        </li>
      {/each}
    </ul>
    {@render more(shown.length)}
  </LoadState>
{/snippet}

{#snippet fristenBody()}
  {#if eventsLoading}<p role="status" class="mt-2 text-sm text-neutral-700">
      Fristen werden geladen …
    </p>
  {:else if campflowEventsStore.error}<p class="mt-2 text-sm text-neutral-700">
      Ohne CampFlow lassen sich die Fristen nicht berechnen.
    </p>
  {:else}
    <p class="text-sm text-neutral-700">
      Abrechnung spätestens {KJR_ABGABE_MONATE} Monate nach Ende
    </p>
    <ul class="mt-1 divide-y divide-neutral-200" data-testid="kjr-fristen">
      {#each fristen as frist (frist.event.id)}
        <li class="py-2">
          <a
            href="/leitendenbereich/abrechnung/{frist.event.id}"
            class="text-link block truncate font-semibold"
            title="{frist.event.title} (Ende {formatDate(frist.ende)})">{frist.event.title}</a
          >
          <p class="text-sm text-neutral-700">
            <span class={frist.bald ? 'font-semibold text-warning' : ''}>
              Abgabe bis {formatDate(frist.frist)}, {kjrRestzeit(frist.tage)}
            </span>
          </p>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="mt-6 space-y-6">
  <section aria-labelledby="favorites-heading">
    <h2 id="favorites-heading" class="font-serif text-lg font-semibold text-brand-900">
      Deine Bereiche
    </h2>
    <LoadState
      data={favoritesStore.loaded ? favoritesStore.modules : null}
      loading={favoritesLoading}
      error={favoritesError}
      loadingText="Favoriten werden geladen …"
      onretry={retryFavorites}
      isEmpty={(selection) => selection.length === 0}
    >
      {#snippet skeleton()}
        <p aria-hidden="true" class="text-sm text-neutral-700">Favoriten werden geladen …</p>
      {/snippet}
      {#snippet empty()}
        <p class="text-sm text-neutral-700">
          Noch keine Favoriten.{recentModules.length > 0
            ? ' Bis dahin stehen hier die zuletzt genutzten Bereiche.'
            : ''}
          {@render favoritesHint()}
        </p>
        {#if recentModules.length > 0}
          <ul class={tileGrid}>
            {#each recentModules as module (module.href)}{@render tile(module, false)}{/each}
          </ul>
        {/if}
      {/snippet}
      <ul class={tileGrid}>
        {#each favoriteModules as module (module.href)}{@render tile(module, true)}{/each}
        {#each recentModules as module (module.href)}{@render tile(module, false)}{/each}
      </ul>
      <p class="mt-1.5 text-sm text-neutral-700">
        {recentModules.length > 0 ? 'Deine Favoriten, danach die zuletzt genutzten Bereiche.' : ''}
        {@render favoritesHint()}
      </p>
    </LoadState>
  </section>

  <section aria-labelledby="for-you-heading">
    <h2 id="for-you-heading" class="font-serif text-lg font-semibold text-brand-900">Für dich</h2>
    {#if cardCount > 0}
      <div class="surface mt-2 grid divide-y divide-neutral-200 {gridColumns}">
        {#if !tasksEmpty}{@render card(
            'open-tasks-heading',
            'Offene Aufgaben',
            '/leitendenbereich/aufgaben',
            'Alle Aufgaben',
            tasksBody
          )}{/if}
        {#if !fristenEmpty}{@render card(
            'kjr-fristen-heading',
            'KJR-Fristen',
            '/leitendenbereich/abrechnung',
            'Zur Abrechnung',
            fristenBody
          )}{/if}
        {#if !eventsEmpty}{@render card(
            'upcoming-heading',
            'Nächste Aktionen',
            '/leitendenbereich/aktionen',
            'Alle Aktionen',
            eventsBody
          )}{/if}
      </div>
    {/if}
    {#if cardCount < 3}
      <ul
        class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-700"
        data-testid="nothing-open"
      >
        {#if eventsEmpty}<li class="flex items-center gap-2">
            {@render check()}<span
              >Keine kommenden Aktionen in CampFlow ·
              <a href="/leitendenbereich/aktionen" class="text-link">Alle Aktionen</a></span
            >
          </li>{/if}
        {#if tasksEmpty}<li class="flex items-center gap-2">
            {@render check()}<span
              >Keine offenen Aufgaben ·
              {#if pendingCount > 0}<a
                  class="text-link font-semibold"
                  href="/leitendenbereich/aufgaben/vorschlaege"
                  >{pendingCount} {pendingCount === 1 ? 'Vorschlag' : 'Vorschläge'} prüfen</a
                > ·
              {/if}<a href="/leitendenbereich/aufgaben" class="text-link">Alle Aufgaben</a></span
            >
          </li>{/if}
        {#if fristenEmpty}<li class="flex items-center gap-2">
            {@render check()}<span
              >Keine offenen KJR-Fristen ·
              <a href="/leitendenbereich/abrechnung" class="text-link">Zur Abrechnung</a></span
            >
          </li>{/if}
      </ul>
    {/if}
  </section>
</div>
