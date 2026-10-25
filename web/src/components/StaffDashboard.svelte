<script lang="ts">
  import { taskHasAssignee, taskAssigneeNames } from '../../../api/lib/aufgaben-zuordnung';
  import { onMount, type Snippet } from 'svelte';
  import { aufgabenStore, loadTasks, loadTaskUsers } from '../lib/aufgabenStore.svelte';
  import { fetchPrincipal } from '../lib/authStore.svelte';
  import {
    favoritesStore,
    canChooseFavorites,
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
  import { nurAktionen } from '../lib/aktionArt';
  import { formatDate, formatEventRange } from '../lib/campflowFields';
  import { dueLabel, dueSoon, pendingTask } from '../lib/aufgabenView';
  import { localDate } from '../lib/dateUtils';
  import { KJR_ABGABE_MONATE, kjrRestzeit, offeneKjrFristen } from '../lib/kjrFristen';
  import CopyCode from './ui/CopyCode.svelte';
  import LoadState from './ui/LoadState.svelte';
  import MessageText from './ui/MessageText.svelte';
  import StatusLabel from './ui/StatusLabel.svelte';
  import {
    belegePflege,
    campflowBelegeStore,
    offeneBeitraegeStore,
  } from '../lib/pflegeStore.svelte';
  import { meineBeitraege } from '../lib/beitraege';
  import { meineBelege } from '../lib/campflowBelege';
  import { isIch } from '../lib/ichStore.svelte';
  import { formatIsoDate } from '../lib/belege';
  import { formatEuro } from '../lib/format';
  import InfoHint from './ui/InfoHint.svelte';

  /** Entries per area; the link next to the heading leads to the full list. */
  const CARD_LIMIT = 3;
  /** Tiles of „Deine Bereiche“: two rows of four on a phone. */
  const TILE_LIMIT = 8;
  const SECONDARY_LOAD_DELAY_MS = 1500;
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
  // Personal areas contain only saved favorites and actual recent visits.
  const selectedModules = $derived(
    yourStaffModules(
      favoritesStore.modules,
      recentStore.modules,
      allModules,
      Math.max(TILE_LIMIT, favoritesStore.modules.length)
    )
  );
  interface PinnedTile {
    href: string;
    index: number;
  }
  let pinned = $state<PinnedTile | null>(null);
  const visibleModules = $derived.by(() => {
    const result = [...selectedModules];
    if (pinned) {
      const module = allModules.find(
        (entry) =>
          entry.href === pinned?.href &&
          (favoritesStore.modules.includes(entry.href) || recentStore.modules.includes(entry.href))
      );
      if (module) {
        const index = result.findIndex((entry) => entry.href === module.href);
        if (index >= 0) result.splice(index, 1);
        result.splice(pinned.index, 0, module);
      }
    }
    return result;
  });
  function pinTile(href: string): void {
    pinned = { href, index: visibleModules.findIndex((module) => module.href === href) };
  }
  const upcoming = $derived(
    nurAktionen(campflowEventsStore.data ?? [])
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
    campflowEventsStore.data !== null &&
      !eventsLoading &&
      !campflowEventsStore.error &&
      upcoming.length === 0
  );
  const fristenEmpty = $derived(
    campflowEventsStore.data !== null &&
      !eventsLoading &&
      !campflowEventsStore.error &&
      fristen.length === 0
  );
  const tasksEmpty = $derived(
    tasks !== null && !tasksLoading && !tasksError && openTasks.length === 0
  );
  const belegeStore = belegePflege.state;
  const campflowStore = campflowBelegeStore.state;
  // Own Auslagen in the module and in CampFlow; CampFlow may answer later or not at all
  const ownBelege = $derived(meineBelege(belegeStore.data ?? [], campflowStore.data, isIch));
  const belegeEmpty = $derived(
    belegeStore.data !== null &&
      !belegeStore.loading &&
      !belegeStore.error &&
      campflowStore.data !== null &&
      !campflowStore.loading &&
      !campflowStore.error &&
      ownBelege.length === 0
  );
  const beitraegeStore = offeneBeitraegeStore.state;
  // Own Beiträge with something left to do, whether to pay or to be paid back
  const ownBeitraege = $derived(meineBeitraege(beitraegeStore.data, isIch));
  const beitraegeEmpty = $derived(
    beitraegeStore.data !== null &&
      !beitraegeStore.loading &&
      !beitraegeStore.error &&
      ownBeitraege.length === 0
  );
  const cards = $derived([eventsEmpty, tasksEmpty, fristenEmpty, belegeEmpty, beitraegeEmpty]);
  const cardCount = $derived(cards.filter((empty) => !empty).length);
  // Side by side once there is room; stacked areas are divided by lines instead
  const gridColumns = $derived(
    cardCount === 5
      ? 'md:grid-cols-2 xl:grid-cols-3'
      : cardCount === 4
        ? 'md:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-y-0'
        : cardCount === 3
          ? 'xl:grid-cols-3 xl:divide-x xl:divide-y-0'
          : cardCount === 2
            ? 'md:grid-cols-2 md:divide-x md:divide-y-0'
            : ''
  );

  onMount(() => {
    // The favorites come first: they are the main content and do not wait for the login check
    const favorites = loadFavorites(STAFF_FAVORITE_PATHS);
    void loadTaskUsers();
    void fetchPrincipal();
    const tasks = loadTasks();
    void loadRecent();
    void fetchNikolausStatus();
    // Prioritize favorites and tasks, but do not let either block the other cards.
    let secondaryPending = true;
    const startSecondary = (): void => {
      if (!secondaryPending) return;
      secondaryPending = false;
      clearTimeout(timeout);
      void fetchCampflowEvents();
      void belegePflege.load();
      void campflowBelegeStore.load({ param: false });
      void offeneBeitraegeStore.load();
    };
    const timeout = setTimeout(startSecondary, SECONDARY_LOAD_DELAY_MS);
    void Promise.allSettled([favorites, tasks]).then(startSecondary);
    return () => {
      secondaryPending = false;
      clearTimeout(timeout);
    };
  });
  function retryFavorites(): void {
    void loadFavorites(STAFF_FAVORITE_PATHS);
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
  <li
    class="group relative min-w-0"
    onfocusout={(event) => {
      if (
        pinned?.href === module.href &&
        (!(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget))
      )
        pinned = null;
    }}
  >
    <a
      onfocus={() => pinTile(module.href)}
      onpointerdown={() => pinTile(module.href)}
      onpointercancel={() => {
        if (pinned?.href === module.href) pinned = null;
      }}
      onpointerleave={(event) => {
        if (
          pinned?.href === module.href &&
          !event.currentTarget.closest('li')?.contains(document.activeElement)
        )
          pinned = null;
      }}
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
    {#if favorite && canChooseFavorites()}
      <!-- With a mouse on hover; on a touch screen a long press on the tile removes it -->
      <button
        type="button"
        class="absolute -top-2 -right-2 flex size-11 items-center justify-center rounded-full border border-neutral-300 bg-surface text-brand-900 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:border-brand-900 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
        aria-label="{module.title} aus deinen Favoriten entfernen"
        title="Aus deinen Favoriten entfernen"
        onclick={() => {
          if (pinned?.href === module.href) pinned = null;
          toggleFavorite(module.href, module.title);
        }}
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

{#snippet belegeBody()}
  <!-- Two sources: what one of them delivered shows even if the other fails -->
  {#if belegeStore.loading && !belegeStore.data}
    <p role="status" class="mt-2 text-sm text-neutral-700">Belege werden geladen …</p>
  {:else if belegeStore.error}
    <p class="mt-2 text-sm text-neutral-700">
      <MessageText text={belegeStore.error} />
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        onclick={() => belegePflege.load({ force: true })}>Erneut versuchen</button
      >
    </p>
  {/if}
  {#if campflowStore.loading && !campflowStore.data}
    <p role="status" class="text-sm text-neutral-700">Belege aus CampFlow werden geladen …</p>
  {:else if campflowStore.error}
    <p class="text-sm text-neutral-700">
      <MessageText text={campflowStore.error} />
      <button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        onclick={() => campflowBelegeStore.load({ force: true, param: false })}
        >Erneut versuchen</button
      >
    </p>
  {/if}
  <ul class="mt-1 divide-y divide-neutral-200" data-testid="meine-belege">
    {#each ownBelege.slice(0, CARD_LIMIT) as beleg (beleg.key)}
      <li>
        <!-- The whole line is the link, so it is easy to hit on a phone -->
        <a href="/leitendenbereich/belege" class="block min-h-11 py-2" title={beleg.title}>
          <span class="text-link block truncate font-semibold">{beleg.title}</span>
          <span class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
            <span
              >{[beleg.date ? formatIsoDate(beleg.date) : '', formatEuro(beleg.amountCent)]
                .filter(Boolean)
                .join(' · ')}</span
            >
            <StatusLabel label={beleg.label} tone={beleg.tone} dot />
          </span>
        </a>
      </li>
    {/each}
  </ul>
  {@render more(ownBelege.length)}
{/snippet}

{#snippet beitraegeBody()}
  <LoadState
    data={beitraegeStore.data}
    loading={beitraegeStore.loading}
    error={beitraegeStore.error}
    loadingText="Beiträge werden geladen …"
    onretry={() => offeneBeitraegeStore.load({ force: true })}
  >
    {#snippet skeleton()}
      <p aria-hidden="true" class="mt-2 text-sm text-neutral-700">Beiträge werden geladen …</p>
    {/snippet}
    <ul class="mt-1 divide-y divide-neutral-200" data-testid="meine-beitraege">
      {#each ownBeitraege.slice(0, CARD_LIMIT) as beitrag (beitrag.id)}
        <li class="py-2">
          <!-- Only the title is the link: the Verwendungszweck is a button that copies it -->
          <a
            href={beitrag.href}
            class="text-link flex items-center font-semibold any-pointer-coarse:min-h-11"
            title={beitrag.title}><span class="truncate">{beitrag.title}</span></a
          >
          <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
            <span class="tabular-nums">{formatEuro(beitrag.dueCent)}</span>
            {#if beitrag.reference}<CopyCode code={beitrag.reference} compact small />{/if}
            <StatusLabel label={beitrag.label} tone={beitrag.tone} dot />
          </span>
        </li>
      {/each}
    </ul>
    {@render more(ownBeitraege.length)}
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
  {#if selectedModules.length > 0}
    <section aria-labelledby="favorites-heading">
      <div class="flex items-center gap-1">
        <h2 id="favorites-heading" class="font-serif text-lg font-semibold text-brand-900">
          Deine Bereiche
        </h2>
        <InfoHint label="Deine Bereiche">
          <p class="pointer-coarse:hidden">
            Zeig mit der Maus auf einen Bereich und klick auf den Stern, um ihn zum Favoriten zu
            machen; das Minus an einer Kachel entfernt ihn wieder.
          </p>
          <p class="hidden pointer-coarse:block">
            Tippe auf den Stern neben einem Bereich, um ihn zum Favoriten zu machen. Das Minus an
            einer Kachel entfernt ihn wieder. Langes Tippen geht auch.
          </p>
        </InfoHint>
      </div>

      <ul class={tileGrid}>
        {#each visibleModules as module (module.href)}
          {@render tile(
            module,
            favoritesStore.loaded && favoritesStore.modules.includes(module.href)
          )}
        {/each}
      </ul>
    </section>
  {/if}
  <div class:sr-only={!favoritesStore.loadError}>
    <LoadState
      data={favoritesStore.loaded ? favoritesStore.modules : null}
      loading={favoritesStore.loading}
      error={favoritesStore.loadError}
      loadingText="Favoriten werden geladen …"
      onretry={retryFavorites}
    >
      {#snippet skeleton()}{/snippet}
      <span hidden></span>
    </LoadState>
  </div>

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
        {#if !belegeEmpty}{@render card(
            'meine-belege-heading',
            'Meine Belege',
            '/leitendenbereich/belege',
            'Zu den Belegen',
            belegeBody
          )}{/if}
        {#if !beitraegeEmpty}{@render card(
            'meine-beitraege-heading',
            'Meine Beiträge',
            '/leitendenbereich/beitraege',
            'Zu den Beiträgen',
            beitraegeBody
          )}{/if}
      </div>
    {/if}
    {#if cardCount < cards.length}
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
        {#if belegeEmpty}<li class="flex items-center gap-2">
            {@render check()}<span
              >Keine offenen Belege ·
              <a href="/leitendenbereich/belege" class="text-link">Beleg einreichen</a></span
            >
          </li>{/if}
        {#if beitraegeEmpty}<li class="flex items-center gap-2">
            {@render check()}<span
              >Keine offenen Beiträge ·
              <a href="/leitendenbereich/beitraege" class="text-link">Zu den Beiträgen</a></span
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
