<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchApi } from '../lib/api';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import { STAFF_MODULES, NIKOLAUS_CONTROL_MODULE } from '../lib/staffModules';
  import { campflowEventsStore, fetchCampflowEvents } from '../lib/campflowStore.svelte';
  import { formatEventRange } from '../lib/campflowFields';
  import { localDate } from '../lib/dateUtils';
  import type { TasksOverview } from '../lib/types';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';

  const modules = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE];
  let favorites = $state<string[]>([]);
  let storageKey = $state<string | null>(null);
  let storageNotice = $state<string | null>(null);
  let selecting = $state(false);
  let tasks = $state<TasksOverview | null>(null);
  let tasksError = $state<string | null>(null);
  let tasksLoading = $state(true);
  const favoriteModules = $derived(modules.filter((module) => favorites.includes(module.href)));
  const upcoming = $derived(
    (campflowEventsStore.data ?? [])
      .filter(
        (event) =>
          !event.archived && event.start_date && event.start_date.slice(0, 10) >= localDate()
      )
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
      .slice(0, 5)
  );
  const openTasks = $derived(
    (tasks?.tasks ?? [])
      .filter((task) => task.state === 'offen')
      .sort(
        (a, b) =>
          (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
          a.title.localeCompare(b.title, 'de')
      )
  );
  const ownTasks = $derived(
    openTasks.filter((task) => task.assignee.toLowerCase() === tasks?.login.toLowerCase())
  );
  async function loadTasks(): Promise<void> {
    tasksLoading = true;
    tasksError = null;
    try {
      tasks = await fetchApi<TasksOverview>('/intern/pflege/aufgaben');
    } catch {
      tasksError = 'Die offenen Aufgaben konnten nicht geladen werden.';
    } finally {
      tasksLoading = false;
    }
  }
  onMount(() => {
    void fetchPrincipal();
    void fetchCampflowEvents();
    void loadTasks();
  });
  // Scope saved preferences to the account on this device; never read another user's list.
  $effect(() => {
    const principal = authStore.principal;
    if (!principal) {
      storageKey = null;
      favorites = [];
      return;
    }
    const key = `phoenix:staff-favorites:v1:${principal.userId}`;
    if (storageKey === key) return;
    storageKey = key;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      favorites = Array.isArray(parsed)
        ? modules.filter((m) => parsed.includes(m.href)).map((m) => m.href)
        : [];
    } catch {
      favorites = [];
      storageNotice =
        'Favoriten lassen sich auf diesem Gerät nicht dauerhaft speichern. Deine Auswahl gilt für diese Ansicht.';
    }
  });
  function toggle(href: string): void {
    favorites = favorites.includes(href)
      ? favorites.filter((path) => path !== href)
      : [...favorites, href];
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(favorites));
    } catch {
      storageNotice =
        'Favoriten lassen sich auf diesem Gerät nicht dauerhaft speichern. Deine Auswahl gilt für diese Ansicht.';
    }
  }
</script>

<div class="mt-6 space-y-8">
  <section aria-labelledby="favorites-heading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="favorites-heading" class="text-2xl font-serif font-semibold text-brand-900">
        Meine Favoriten
      </h2>
      <ActionButton
        type="button"
        variant="secondary"
        onclick={() => (selecting = !selecting)}
        aria-expanded={selecting}
        aria-controls="favorite-options"
        disabled={!storageKey}>Favoriten auswählen</ActionButton
      >
    </div>
    <StatusNotice message={storageNotice} />
    <ul class="mt-3 divide-y divide-neutral-200">
      {#each favoriteModules as module (module.href)}
        <li class="py-3 flex items-center justify-between gap-3">
          <a href={module.href} class="text-link font-semibold">{module.title}</a><ActionButton
            type="button"
            variant="secondary"
            onclick={() => toggle(module.href)}
            aria-label="{module.title} aus Favoriten entfernen">Entfernen</ActionButton
          >
        </li>
      {:else}<li class="py-3 text-neutral-700">
          Wähle die Bereiche, die du häufig nutzt. Alle Bereiche findest du weiter unten.
        </li>{/each}
    </ul>
    {#if selecting}
      <div id="favorite-options" class="mt-3 grid sm:grid-cols-2 gap-x-5">
        {#each modules as module (module.href)}
          <label class="min-h-11 flex items-center gap-3 border-t border-neutral-200 py-2"
            ><input
              type="checkbox"
              checked={favorites.includes(module.href)}
              onchange={() => toggle(module.href)}
            />{module.title}</label
          >
        {/each}
      </div>
    {/if}
  </section>
  <section aria-labelledby="upcoming-heading">
    <h2 id="upcoming-heading" class="text-2xl font-serif font-semibold text-brand-900">
      Nächste Aktionen
    </h2>
    {#if campflowEventsStore.loading}<p role="status" class="mt-3">Aktionen werden geladen …</p>
    {:else if campflowEventsStore.error}<StatusNotice
        kind="error"
        message={campflowEventsStore.error}
      /><ActionButton
        type="button"
        variant="secondary"
        onclick={() => fetchCampflowEvents({ force: true })}>Aktionen neu laden</ActionButton
      >
    {:else}
      <ul class="mt-3 divide-y divide-neutral-200">
        {#each upcoming as event (event.id)}<li class="py-3">
            <a
              class="text-link font-semibold"
              href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(event.id)}"
              >{event.title}</a
            >
            <p class="text-sm text-neutral-700">{formatEventRange(event)}</p>
          </li>{:else}<li class="py-3 text-neutral-700">
            Derzeit sind keine kommenden CampFlow-Aktionen verfügbar.
          </li>{/each}
      </ul>
    {/if}
    <a href="/leitendenbereich/aktionen" class="text-link text-sm">Alle Aktionen</a>
  </section>
  <section aria-labelledby="open-tasks-heading">
    <h2 id="open-tasks-heading" class="text-2xl font-serif font-semibold text-brand-900">
      Offene Aufgaben
    </h2>
    {#if tasksLoading}<p class="mt-3" role="status">Aufgaben werden geladen …</p>
    {:else if tasksError}<StatusNotice kind="error" message={tasksError} /><ActionButton
        type="button"
        variant="secondary"
        onclick={loadTasks}>Aufgaben neu laden</ActionButton
      >
    {:else}
      <p class="mt-2 text-sm text-neutral-700">
        {ownTasks.length} deinem Login zugewiesen · {openTasks.length} insgesamt offen
      </p>
      <ul class="mt-3 divide-y divide-neutral-200">
        {#each (ownTasks.length ? ownTasks : openTasks).slice(0, 5) as task (task.id)}
          <li class="py-3">
            <a
              href="/leitendenbereich/aufgaben#aufgabe-{task.id}"
              class="text-link font-semibold break-words">{task.title}</a
            >
            <p class="text-sm text-neutral-700 break-words">
              {task.assignee || 'Nicht zugewiesen'} · {task.dueDate
                ? `Fällig: ${task.dueDate}`
                : 'Ohne Frist'}
            </p>
          </li>
        {:else}<li class="py-3 text-neutral-700">
            Alle Aufgaben sind erledigt oder es wurden noch keine angelegt.
          </li>{/each}
      </ul>
    {/if}
    <a href="/leitendenbereich/aufgaben" class="text-link text-sm">Alle Aufgaben und Checklisten</a>
  </section>
</div>
