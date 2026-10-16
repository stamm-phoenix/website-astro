<script lang="ts">
  import { taskHasAssignee, taskAssigneeNames } from '../../../api/lib/aufgaben-zuordnung';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { aufgabenStore, loadTasks, loadTaskUsers } from '../lib/aufgabenStore.svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import {
    favoritesStore,
    favoritesUnsaved,
    loadFavorites,
    saveFavorites,
    toggleFavorite,
  } from '../lib/staffFavoritesStore.svelte';
  import { guardUnsavedChanges } from '../lib/unsavedChanges';
  import { STAFF_MODULES, NIKOLAUS_CONTROL_MODULE } from '../lib/staffModules';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatDate, formatEventRange } from '../lib/campflowFields';
  import { dueLabel, dueSoon, pendingTask } from '../lib/aufgabenView';
  import { localDate } from '../lib/dateUtils';
  import { KJR_ABGABE_MONATE, kjrRestzeit, offeneKjrFristen } from '../lib/kjrFristen';
  import ActionButton from './ui/ActionButton.svelte';
  import LoadState from './ui/LoadState.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  /** Entries per card; the link in the card header leads to the full list. */
  const CARD_LIMIT = 3;
  const modules = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE];
  let selecting = $state(false);
  const tasks = $derived(aufgabenStore.data);
  const users = $derived(aufgabenStore.users);
  const tasksError = $derived(aufgabenStore.error);
  const tasksLoading = $derived(aufgabenStore.loading);
  const eventsLoading = $derived(campflowEventsStore.loading);
  const favoriteModules = $derived(
    modules.filter((module) => favoritesStore.modules.includes(module.href))
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
  const gridColumns = $derived(
    cardCount === 3 ? 'md:grid-cols-3' : cardCount === 2 ? 'md:grid-cols-2' : ''
  );

  onMount(() => {
    void loadTaskUsers();
    void fetchPrincipal();
    void fetchCampflowEvents();
    void loadTasks();
  });
  const modulePaths = modules.map((module) => module.href);
  function reloadFavorites(): void {
    const userId = authStore.principal?.userId;
    if (userId) void loadFavorites(userId, modulePaths);
  }
  $effect(() => {
    if (authStore.principal) untrack(reloadFavorites);
  });
  // A selection that failed to save is lost when leaving, so ask first
  $effect(() => guardUnsavedChanges(favoritesUnsaved));
</script>

{#snippet card(id: string, title: string, href: string, linkLabel: string, body: Snippet)}
  <section aria-labelledby={id} class="surface min-w-0 p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 {id} class="font-serif text-lg font-semibold text-brand-900">{title}</h2>
      <a {href} class="text-link text-sm">{linkLabel}</a>
    </div>
    {@render body()}
  </section>
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
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 id="favorites-heading" class="font-serif text-lg font-semibold text-brand-900">
        Meine Favoriten
      </h2>
      {#if favoriteModules.length > 0}
        <ul class="contents">
          {#each favoriteModules as module (module.href)}
            <li>
              <a
                href={module.href}
                class="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-300 px-3 text-sm font-semibold text-brand-900 no-underline hover:border-brand-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
              >
                <svg
                  class="size-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"><path d={module.icon} /></svg
                >{module.title}</a
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-neutral-700">Noch keine – wähle Bereiche, die du häufig nutzt.</p>
      {/if}
      <button
        type="button"
        class="text-link min-h-10 text-sm"
        onclick={() => (selecting = !selecting)}
        aria-expanded={selecting}
        aria-controls="favorite-options"
        disabled={!favoritesStore.loaded}>Favoriten auswählen</button
      >
    </div>
    {#if favoritesStore.loading}
      <p role="status" class="mt-1 text-sm text-neutral-700">Favoriten werden geladen …</p>
    {:else if favoritesStore.loadError}
      <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusNotice message={favoritesStore.loadError} kind="error" />
        <ActionButton class="min-h-11" onclick={reloadFavorites}>Erneut laden</ActionButton>
      </div>
    {/if}
    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
      <StatusNotice
        message={favoritesStore.notice?.text ?? null}
        kind={favoritesStore.notice?.kind}
        popup
      />
      {#if favoritesStore.notice?.kind === 'error'}
        <ActionButton class="min-h-11" onclick={saveFavorites}>Erneut speichern</ActionButton>
      {/if}
    </div>
    {#if selecting}
      <p class="mt-2 text-sm text-neutral-700">
        Häkchen werden sofort gespeichert und gelten auf allen Geräten, auf denen du angemeldet
        bist.
      </p>
      <div id="favorite-options" class="mt-2 grid gap-x-5 sm:grid-cols-2 md:grid-cols-3">
        {#each modules as module (module.href)}
          <label class="flex min-h-11 items-center gap-3 border-t border-neutral-200 py-2"
            ><input
              type="checkbox"
              checked={favoritesStore.modules.includes(module.href)}
              onchange={() => toggleFavorite(module.href)}
            />{module.title}</label
          >
        {/each}
      </div>
    {/if}
  </section>

  {#if cardCount > 0}
    <div class="grid gap-4 {gridColumns}">
      {#if !eventsEmpty}{@render card(
          'upcoming-heading',
          'Nächste Aktionen',
          '/leitendenbereich/aktionen',
          'Alle Aktionen',
          eventsBody
        )}{/if}
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
    </div>
  {/if}

  {#if cardCount < 3}
    <ul class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-700" data-testid="nothing-open">
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
</div>
