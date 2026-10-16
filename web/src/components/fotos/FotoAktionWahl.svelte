<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { SESSION_EXPIRED_MESSAGE } from '../../lib/api';
  import { campflowEventsStore, fetchCampflowEvents } from '../../lib/campflowStore.svelte';
  import { formatDate } from '../../lib/campflowFields';
  import {
    fotoAktionen,
    recentFotoAktionen,
    searchFotoAktionen,
    type FotoAktion,
  } from '../../lib/fotoAktionen';
  import { todayIso } from '../../lib/format';
  import { aktionenPflege } from '../../lib/pflegeStore.svelte';

  interface Props {
    selected: FotoAktion | null;
    error?: string;
  }
  let { selected = $bindable(), error }: Props = $props();

  const SEARCH_LIMIT = 40;
  const calendar = aktionenPflege.state;
  const today = todayIso();

  let search = $state('');
  let showAll = $state(false);
  /** The list is open while choosing; after a choice it folds to the chosen Aktion. */
  let choosing = $state(untrack(() => !selected));

  function choose(item: FotoAktion): void {
    selected = item;
    choosing = false;
  }

  const all = $derived(
    fotoAktionen(campflowEventsStore.data ?? [], calendar.data?.items ?? [], today)
  );
  const recent = $derived(recentFotoAktionen(all, today));
  const query = $derived(search.trim());
  const visible = $derived.by(() => {
    if (query) return searchFotoAktionen(all, query).slice(0, SEARCH_LIMIT);
    const list = showAll || recent.length === 0 ? all : recent;
    // The chosen Aktion stays visible when the list changes
    return selected && !list.some((item) => item.key === selected?.key)
      ? [selected, ...list]
      : list;
  });
  const loading = $derived(
    (campflowEventsStore.loading && !campflowEventsStore.data) ||
      (calendar.loading && !calendar.data)
  );
  const campflowFailed = $derived(!!campflowEventsStore.error && !campflowEventsStore.data);
  const calendarFailed = $derived(!!calendar.error && !calendar.data);

  $effect(() => {
    untrack(() => {
      void fetchCampflowEvents();
      void aktionenPflege.load();
    });
  });

  function retry(): void {
    void fetchCampflowEvents({ force: true });
    void aktionenPflege.load({ force: true });
  }

  function range(item: FotoAktion): string {
    const start = formatDate(item.start);
    const end = formatDate(item.end);
    if (!start && !end) return `Ohne Datum, Ordner ${item.year}`;
    if (!start || !end || start === end) return start || end;
    return `${start} – ${end}`;
  }
</script>

<fieldset aria-describedby={error ? 'foto-aktion-error' : undefined}>
  <legend class="form-label">Aktion</legend>
  {#if selected && !choosing}
    <div class="flex flex-wrap items-center justify-between gap-2 border-y border-neutral-200 py-2">
      <span class="min-w-0">
        <span class="block font-semibold text-brand-900">{selected.title}</span>
        <span class="block text-sm text-neutral-700">{range(selected)}</span>
      </span>
      <ActionButton onclick={() => (choosing = true)}>Andere Aktion wählen</ActionButton>
    </div>
  {:else}
    <label for="foto-aktion-suche" class="sr-only">Aktion suchen</label>
    <input
      id="foto-aktion-suche"
      type="search"
      class="form-input"
      placeholder="Aktion suchen, z. B. Sommerlager"
      autocomplete="off"
      bind:value={search}
    />

    {#if campflowFailed && calendarFailed}
      <div class="mt-3 text-sm text-danger" role="alert">
        <!-- The stores' messages, e.g. an expired login with the link to log in again -->
        <p>
          <MessageText
            text={campflowEventsStore.error ??
              calendar.error ??
              'Die Aktionen konnten nicht geladen werden. Prüfe deine Internetverbindung.'}
          />
          Du kannst stattdessen oben „Ordner selbst wählen“ nehmen.
        </p>
        <ActionButton class="mt-2" onclick={retry}>Erneut versuchen</ActionButton>
      </div>
    {:else}
      {#if campflowEventsStore.error === SESSION_EXPIRED_MESSAGE || calendar.error === SESSION_EXPIRED_MESSAGE}
        <p class="mt-2 text-sm text-warning">
          <MessageText text={SESSION_EXPIRED_MESSAGE} /> Danach tippe auf „Erneut versuchen“.
        </p>
        <ActionButton class="mt-2" onclick={retry}>Erneut versuchen</ActionButton>
      {:else if campflowFailed}
        <p class="mt-2 text-sm text-warning">
          CampFlow ist gerade nicht erreichbar, deshalb fehlen hier Aktionen. Fehlt deine, nimm oben
          „Ordner selbst wählen“.
        </p>
      {:else if calendarFailed}
        <div class="mt-2 text-sm text-warning">
          <p>
            Die Aktionen aus dem Kalender der Website konnten nicht geladen werden, deshalb fehlen
            Aktionen ohne CampFlow. Prüfe deine Internetverbindung oder nimm oben „Ordner selbst
            wählen“.
          </p>
          <ActionButton class="mt-2" onclick={retry}>Erneut versuchen</ActionButton>
        </div>
      {/if}
      {#if loading}
        <div class="mt-3 space-y-2" role="status" aria-live="polite">
          <span class="sr-only">Aktionen werden geladen …</span>
          {#each [1, 2, 3] as n (n)}
            <div class="skeleton-element h-12 rounded-[var(--radius-lg)]"></div>
          {/each}
        </div>
      {:else}
        {#if !query && !showAll && recent.length > 0}
          <p class="mt-3 text-sm text-neutral-700">Aktionen der letzten Monate:</p>
        {/if}
        {#if visible.length === 0}
          <p class="mt-3 text-sm text-neutral-700">
            {query
              ? `Keine Aktion mit „${query}“ gefunden. Fehlt deine, nimm oben „Ordner selbst wählen“.`
              : 'Keine Aktionen gefunden. Nimm oben „Ordner selbst wählen“.'}
          </p>
        {:else}
          <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
            {#each visible as item (item.key)}
              <li>
                <label class="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                  <input
                    type="radio"
                    name="foto-aktion"
                    class="size-5 shrink-0"
                    checked={selected?.key === item.key}
                    onchange={() => choose(item)}
                  />
                  <span class="min-w-0">
                    <span class="block font-semibold text-brand-900">{item.title}</span>
                    <span class="block text-sm text-neutral-700">{range(item)}</span>
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
        {#if !query && !showAll && recent.length > 0 && all.length > recent.length}
          <ActionButton class="mt-2" onclick={() => (showAll = true)}>
            Alle Aktionen anzeigen ({all.length})
          </ActionButton>
        {/if}
      {/if}
    {/if}
  {/if}
  {#if error}
    <p id="foto-aktion-error" class="mt-2 text-sm font-semibold text-danger">{error}</p>
  {/if}
</fieldset>
