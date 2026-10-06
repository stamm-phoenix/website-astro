<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import { campflowDetailStore, fetchCampflowEvent } from '../lib/campflowStore.svelte';
  import {
    PERSON_STATUS_LABEL,
    defaultColumnKeys,
    formatEventRange,
    formatName,
    getPersonColumns,
    personStatus,
  } from '../lib/campflowFields';
  import type { PersonStatus } from '../lib/campflowFields';
  import type { CampflowPerson } from '../lib/types';
  import CampflowPersonDetails from './CampflowPersonDetails.svelte';

  const STATUS_ORDER: PersonStatus[] = ['confirmed', 'registered', 'cancelled'];

  /** Status as coloured text with a small dot instead of a pill. */
  const STATUS_TONE: Record<PersonStatus, { text: string; dot: string }> = {
    confirmed: {
      text: 'text-success',
      dot: 'bg-success',
    },
    registered: { text: 'text-brand-800', dot: 'bg-action' },
    cancelled: { text: 'text-danger', dot: 'bg-danger' },
  };

  let id = $state('');
  let statuses = $state<PersonStatus[]>(['confirmed', 'registered']);
  let search = $state('');
  let sortKey = $state('name');
  let sortAsc = $state(true);
  let visibleKeys = $state<string[] | null>(null);
  let selected = $state<CampflowPerson | null>(null);

  const detail = $derived(id ? (campflowDetailStore.data[id] ?? null) : null);
  const persons = $derived(detail?.persons ?? []);
  const available = $derived(
    detail ? getPersonColumns(detail.persons, detail.columns, detail.event) : []
  );
  const shownColumns = $derived.by(() => {
    const keys = visibleKeys ?? (detail ? defaultColumnKeys(available, detail.columns) : []);
    return available.filter((c) => keys.includes(c.key));
  });

  const active = $derived(persons.filter((p) => personStatus(p) !== 'cancelled'));
  const stats = $derived({
    active: active.length,
    confirmed: persons.filter((p) => personStatus(p) === 'confirmed').length,
    cancelled: persons.filter((p) => personStatus(p) === 'cancelled').length,
    vegetarian: active.filter((p) => Array.isArray(p.diet) && p.diet.includes('vegetarian')).length,
    vegan: active.filter((p) => Array.isArray(p.diet) && p.diet.includes('vegan')).length,
    intolerances: active.filter((p) => Array.isArray(p.intolerances) && p.intolerances.length > 0)
      .length,
    nonSwimmers: active.filter((p) => p.swimming === false).length,
  });

  const visible = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const sortColumn = available.find((c) => c.key === sortKey) ?? available[0];
    return persons
      .filter((p) => statuses.includes(personStatus(p)))
      .filter((p) => !query || available.some((c) => c.text(p).toLowerCase().includes(query)))
      .sort((a, b) => {
        if (!sortColumn) return 0;
        const va = sortColumn.sortValue(a);
        const vb = sortColumn.sortValue(b);
        const result =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'de');
        return sortAsc ? result : -result;
      });
  });

  function storageKey(): string {
    return `campflow-columns:${id}`;
  }

  $effect(() => {
    untrack(() => {
      id = new URLSearchParams(window.location.search).get('id') ?? '';
      if (!id) return;
      try {
        const stored = localStorage.getItem(storageKey());
        if (stored) visibleKeys = JSON.parse(stored) as string[];
      } catch {
        // Storage unavailable, use the default columns
      }
      fetchCampflowEvent(id);
    });
  });

  function toggleColumn(key: string): void {
    const current = shownColumns.map((c) => c.key);
    visibleKeys = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    try {
      localStorage.setItem(storageKey(), JSON.stringify(visibleKeys));
    } catch {
      // Not persisted, fine
    }
  }

  function resetColumns(): void {
    visibleKeys = null;
    try {
      localStorage.removeItem(storageKey());
    } catch {
      // Ignore
    }
  }

  function toggleStatus(status: PersonStatus): void {
    statuses = statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status];
  }

  function sortBy(key: string): void {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  }
</script>

{#snippet statusLabel(status: PersonStatus)}
  <span class="inline-flex items-center gap-1.5 font-semibold {STATUS_TONE[status].text}">
    <span aria-hidden="true" class="size-2 shrink-0 rounded-full {STATUS_TONE[status].dot}"></span>
    {PERSON_STATUS_LABEL[status]}
  </span>
{/snippet}

{#if !id}
  <div role="alert" class="border-t border-neutral-200 pt-5">
    <p class="text-sm text-neutral-700">
      Keine Aktion ausgewählt. <a
        class="font-semibold text-link underline"
        href="/leitendenbereich/aktionen">Zur Übersicht</a
      >
    </p>
  </div>
{:else if !detail && campflowDetailStore.loading}
  <div role="status" aria-live="polite">
    <span class="sr-only">Aktion wird geladen …</span>
    <div class="skeleton-element h-8 w-72 max-w-full rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-56 rounded"></div>
    <div class="skeleton-element mt-8 h-40 w-full rounded"></div>
  </div>
{:else if !detail}
  <div role="alert" class="border-l-2 border-danger py-1 pl-4">
    <h2 class="text-lg font-semibold text-brand-900">Aktion konnte nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">{campflowDetailStore.error}</p>
    <ActionButton
      variant="primary"
      type="button"
      class="mt-4"
      onclick={() => fetchCampflowEvent(id, { force: true })}
    >
      Erneut versuchen
    </ActionButton>
  </div>
{:else}
  {@const event = detail.event}
  <div class="space-y-8">
    <section
      class="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6"
      aria-labelledby="event-heading"
    >
      <div>
        <h1 id="event-heading" class="font-serif text-3xl font-semibold text-brand-900 md:text-4xl">
          {event.title}
        </h1>
        <p class="mt-2 font-semibold text-brand-800">{formatEventRange(event)}</p>
        <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
          <span
            class="inline-flex items-center gap-1.5 font-semibold {event.published
              ? 'text-success'
              : 'text-neutral-700'}"
          >
            <span
              aria-hidden="true"
              class="size-2 rounded-full {event.published
                ? 'bg-success'
                : 'border border-neutral-500'}"
            ></span>
            {event.published ? 'Anmeldung offen' : 'Anmeldung geschlossen'}
          </span>
          {#if event.collection}
            <span aria-hidden="true">·</span>
            <span>{event.collection.name}</span>
          {/if}
          {#if event.archived}
            <span aria-hidden="true">·</span>
            <span>Archiviert</span>
          {/if}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if event.url}
          <a href={event.url} target="_blank" rel="noopener noreferrer" class="btn-secondary">
            Anmeldeformular<span class="sr-only"> (öffnet in neuem Tab)</span>
          </a>
        {/if}
        <ActionButton
          variant="secondary"
          type="button"
          disabled={campflowDetailStore.loading}
          onclick={() => fetchCampflowEvent(id, { force: true })}
        >
          {campflowDetailStore.loading ? 'Lädt …' : 'Neu laden'}
        </ActionButton>
      </div>
    </section>

    <section aria-labelledby="event-stats-heading">
      <h2 id="event-stats-heading" class="sr-only">Überblick</h2>
      <dl
        class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-4 border-b border-neutral-200 pb-6"
      >
        {#snippet stat(label: string, value: string | number, hint?: string)}
          <div>
            <dt class="text-sm text-neutral-700">{label}</dt>
            <dd class="mt-0.5 text-2xl font-semibold tabular-nums text-brand-900">
              {value}{#if hint}<span class="text-sm font-normal text-neutral-700">{hint}</span>{/if}
            </dd>
          </div>
        {/snippet}
        {@render stat(
          'Angemeldet',
          stats.active,
          event.max_persons ? ` / ${event.max_persons}` : undefined
        )}
        {@render stat('Bestätigt', stats.confirmed)}
        {@render stat('Storniert', stats.cancelled)}
        {@render stat('Vegetarisch', stats.vegetarian)}
        {@render stat('Vegan', stats.vegan)}
        {@render stat('Unverträglichkeiten', stats.intolerances)}
        {#if stats.nonSwimmers > 0}
          {@render stat('Nichtschwimmer*innen', stats.nonSwimmers)}
        {/if}
      </dl>
    </section>

    <section aria-labelledby="participants-heading" class="space-y-4">
      <h2 id="participants-heading" class="font-serif text-2xl font-semibold text-brand-900">
        Teilnehmende
      </h2>

      <form
        class="relative z-30 grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end"
        role="search"
        aria-label="Teilnehmende filtern"
        onsubmit={(e) => e.preventDefault()}
      >
        <label class="block text-sm">
          <span class="form-label">Suche</span>
          <input
            type="search"
            bind:value={search}
            placeholder="In allen sichtbaren Feldern suchen …"
            class="form-input"
          />
        </label>

        <fieldset class="text-sm">
          <legend class="form-label">Status</legend>
          <div class="mt-1 flex flex-wrap gap-x-5">
            {#each STATUS_ORDER as status (status)}
              <button
                type="button"
                aria-pressed={statuses.includes(status)}
                onclick={() => toggleStatus(status)}
                class="py-2 font-semibold decoration-2 underline-offset-[6px] {statuses.includes(
                  status
                )
                  ? `underline ${STATUS_TONE[status].text}`
                  : 'text-neutral-700 hover:text-brand-900 hover:underline'}"
              >
                {PERSON_STATUS_LABEL[status]}
              </button>
            {/each}
          </div>
        </fieldset>

        <details class="relative text-sm">
          <summary class="btn-secondary cursor-pointer list-none tabular-nums">
            Spalten ({shownColumns.length}/{available.length})
          </summary>
          <div
            class="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-surface p-3 shadow-lift"
          >
            <ul class="space-y-1">
              {#each available as column (column.key)}
                <li>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={shownColumns.some((c) => c.key === column.key)}
                      onchange={() => toggleColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                </li>
              {/each}
            </ul>
            <button
              type="button"
              class="mt-3 border-t border-neutral-200 pt-2 text-sm font-semibold text-brand-800 underline"
              onclick={resetColumns}
            >
              Standardauswahl
            </button>
          </div>
        </details>
      </form>

      <p class="text-sm text-neutral-700" aria-live="polite">
        {visible.length}
        {visible.length === 1 ? 'Person' : 'Personen'} angezeigt
      </p>

      {#if visible.length === 0}
        <p class="border-t border-neutral-200 pt-4 text-sm text-neutral-700">
          {persons.length === 0
            ? 'Für diese Aktion gibt es noch keine Anmeldungen.'
            : 'Keine Teilnehmenden für diese Filter.'}
        </p>
      {:else}
        <!-- Desktop: table -->
        <div class="hidden overflow-x-auto md:block">
          <table class="w-full border-b border-neutral-200 text-left text-sm">
            <thead class="border-b-2 border-neutral-300 text-neutral-700">
              <tr>
                {#each shownColumns as column (column.key)}
                  <th
                    scope="col"
                    class="whitespace-nowrap px-3 py-2 first:pl-0"
                    aria-sort={ariaSort(column.key)}
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 font-semibold hover:text-brand-900"
                      onclick={() => sortBy(column.key)}
                    >
                      {column.label}
                      <span aria-hidden="true" class="w-3 text-brand-800">
                        {sortKey === column.key ? (sortAsc ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                {/each}
                <th scope="col" class="px-3 py-2"><span class="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200">
              {#each visible as person (person.id)}
                {@const status = personStatus(person)}
                <tr class="hover:bg-[var(--color-brand-50)]/60">
                  {#each shownColumns as column (column.key)}
                    <td class="max-w-[18rem] px-3 py-3 align-top first:pl-0">
                      {#if column.key === 'status'}
                        {@render statusLabel(status)}
                      {:else if column.key === 'name'}
                        <span class="font-semibold text-brand-900">{column.text(person)}</span>
                      {:else}
                        <span class="line-clamp-3">{column.text(person)}</span>
                      {/if}
                    </td>
                  {/each}
                  <td class="px-3 py-3 pr-0 text-right align-top">
                    <button
                      type="button"
                      class="font-semibold text-brand-800 underline underline-offset-2 hover:text-brand-900"
                      onclick={() => (selected = person)}
                    >
                      Details<span class="sr-only"> zu {formatName(person)}</span>
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Mobile: list -->
        <ul class="divide-y divide-neutral-200 border-y border-neutral-200 md:hidden">
          {#each visible as person (person.id)}
            {@const status = personStatus(person)}
            <li>
              <button
                type="button"
                class="group block w-full py-4 text-left"
                onclick={() => (selected = person)}
              >
                <span class="flex items-start justify-between gap-3">
                  <span class="font-semibold text-brand-900 group-hover:underline"
                    >{formatName(person)}</span
                  >
                  <span class="text-sm">{@render statusLabel(status)}</span>
                </span>
                <span class="mt-1 block space-y-0.5 text-sm text-neutral-700">
                  {#each shownColumns.filter((c) => !['name', 'status'].includes(c.key) && c.text(person)) as column (column.key)}
                    <span class="block">
                      <span class="font-semibold">{column.label}:</span>
                      {column.text(person)}
                    </span>
                  {/each}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <CampflowPersonDetails
    person={selected}
    {event}
    columns={detail.columns}
    onclose={() => (selected = null)}
  />
{/if}
