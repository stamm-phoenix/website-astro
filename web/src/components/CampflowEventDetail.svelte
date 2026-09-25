<script lang="ts">
  import { untrack } from 'svelte';
  import { campflowDetailStore, fetchCampflowEvent } from '../lib/campflowStore.svelte';
  import {
    PERSON_STATUS_CLASS,
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

{#if !id}
  <div role="alert" class="surface p-6">
    <p class="text-sm text-neutral-700">
      Keine Aktion ausgewählt. <a
        class="font-semibold text-brand-800 underline"
        href="/leitendenbereich/aktionen">Zur Übersicht</a
      >
    </p>
  </div>
{:else if !detail && campflowDetailStore.loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Aktion wird geladen …</span>
    <div class="skeleton-element h-8 w-72 max-w-full rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-56 rounded"></div>
    <div class="skeleton-element mt-8 h-40 w-full rounded"></div>
  </div>
{:else if !detail}
  <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Aktion konnte nicht geladen werden</h2>
    <p class="mt-1 text-sm text-neutral-700">{campflowDetailStore.error}</p>
    <button
      type="button"
      class="mt-4 rounded-full bg-[var(--color-dpsg-red)] px-5 py-2 text-sm font-semibold text-white"
      onclick={() => fetchCampflowEvent(id, { force: true })}
    >
      Erneut versuchen
    </button>
  </div>
{:else}
  {@const event = detail.event}
  <div class="space-y-6">
    <section
      class="surface-muted relative overflow-hidden border border-[var(--color-neutral-200)]/80 p-6 md:p-8"
      aria-labelledby="event-heading"
    >
      <div class="grid-overlay"></div>
      <div class="relative z-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="event-heading" class="font-serif text-3xl font-semibold text-brand-900">
            {event.title}
          </h1>
          <p class="mt-1 font-semibold text-brand-800">{formatEventRange(event)}</p>
          <p class="mt-3 flex flex-wrap gap-1.5">
            <span
              class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium {event.published
                ? 'bg-[#e3f1e8] text-[var(--color-dpsg-pfadfinder)]'
                : 'bg-[var(--color-neutral-100)] text-neutral-700'}"
            >
              {event.published ? 'Anmeldung offen' : 'Anmeldung geschlossen'}
            </span>
            {#if event.collection}
              <span
                class="inline-flex items-center rounded bg-[var(--color-brand-50)] px-2 py-0.5 text-xs font-medium text-brand-800"
              >
                {event.collection.name}
              </span>
            {/if}
            {#if event.archived}
              <span
                class="inline-flex items-center rounded bg-[var(--color-neutral-100)] px-2 py-0.5 text-xs font-medium text-neutral-700"
              >
                Archiviert
              </span>
            {/if}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          {#if event.url}
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center rounded-full border border-[var(--color-brand-300)] bg-white px-4 py-2 text-sm font-semibold no-underline text-brand-900 hover:bg-[var(--color-brand-50)]"
            >
              Anmeldeformular<span class="sr-only"> (öffnet in neuem Tab)</span>
            </a>
          {/if}
          <button
            type="button"
            class="rounded-full border border-[var(--color-brand-300)] bg-white px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-[var(--color-brand-50)] disabled:opacity-60"
            disabled={campflowDetailStore.loading}
            onclick={() => fetchCampflowEvent(id, { force: true })}
          >
            {campflowDetailStore.loading ? 'Lädt …' : 'Neu laden'}
          </button>
        </div>
      </div>
    </section>

    <section aria-labelledby="event-stats-heading">
      <h2 id="event-stats-heading" class="sr-only">Überblick</h2>
      <dl class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
        {#snippet stat(label: string, value: string | number, hint?: string)}
          <div class="surface p-4">
            <dt class="text-sm text-neutral-700">{label}</dt>
            <dd class="mt-1 text-2xl font-semibold tabular-nums text-brand-900">
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
        class="surface grid gap-4 p-4 md:grid-cols-[1fr_auto_auto] md:items-end"
        role="search"
        aria-label="Teilnehmende filtern"
        onsubmit={(e) => e.preventDefault()}
      >
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Suche</span>
          <input
            type="search"
            bind:value={search}
            placeholder="In allen sichtbaren Feldern suchen …"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none"
          />
        </label>

        <fieldset class="text-sm">
          <legend class="font-semibold text-neutral-700">Status</legend>
          <div class="mt-1 flex flex-wrap gap-1.5">
            {#each STATUS_ORDER as status (status)}
              <button
                type="button"
                aria-pressed={statuses.includes(status)}
                onclick={() => toggleStatus(status)}
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition aria-[pressed=false]:border-neutral-300 aria-[pressed=false]:bg-white aria-[pressed=false]:text-neutral-700 {statuses.includes(
                  status
                )
                  ? PERSON_STATUS_CLASS[status]
                  : ''}"
              >
                {PERSON_STATUS_LABEL[status]}
              </button>
            {/each}
          </div>
        </fieldset>

        <details class="relative text-sm">
          <summary
            class="cursor-pointer list-none rounded-full border border-[var(--color-brand-300)] bg-white px-4 py-2 font-semibold text-brand-900 hover:bg-[var(--color-brand-50)]"
          >
            Spalten ({shownColumns.length}/{available.length})
          </summary>
          <div
            class="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-3 shadow-lift"
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
              class="mt-3 text-xs font-semibold text-brand-800 underline"
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
        <p class="surface p-6 text-sm text-neutral-700">
          {persons.length === 0
            ? 'Für diese Aktion gibt es noch keine Anmeldungen.'
            : 'Keine Teilnehmenden für diese Filter.'}
        </p>
      {:else}
        <!-- Desktop: table -->
        <div class="surface hidden overflow-x-auto md:block">
          <table class="w-full text-left text-sm">
            <thead
              class="border-b border-neutral-200 text-xs uppercase tracking-[0.06em] text-neutral-700"
            >
              <tr>
                {#each shownColumns as column (column.key)}
                  <th
                    scope="col"
                    class="whitespace-nowrap px-4 py-3"
                    aria-sort={ariaSort(column.key)}
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 font-semibold uppercase hover:text-brand-900"
                      onclick={() => sortBy(column.key)}
                    >
                      {column.label}
                      <span aria-hidden="true" class="w-3 text-brand-800">
                        {sortKey === column.key ? (sortAsc ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                {/each}
                <th scope="col" class="px-4 py-3"><span class="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {#each visible as person (person.id)}
                {@const status = personStatus(person)}
                <tr
                  class="border-b border-neutral-100 last:border-0 hover:bg-[var(--color-brand-50)]/60"
                >
                  {#each shownColumns as column (column.key)}
                    <td class="max-w-[18rem] px-4 py-3 align-top">
                      {#if column.key === 'status'}
                        <span class="pill border text-xs {PERSON_STATUS_CLASS[status]}">
                          {PERSON_STATUS_LABEL[status]}
                        </span>
                      {:else if column.key === 'name'}
                        <span class="font-semibold text-brand-900">{column.text(person)}</span>
                      {:else}
                        <span class="line-clamp-3">{column.text(person)}</span>
                      {/if}
                    </td>
                  {/each}
                  <td class="px-4 py-3 text-right align-top">
                    <button
                      type="button"
                      class="rounded-full border border-[var(--color-brand-300)] bg-white px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-[var(--color-brand-50)]"
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

        <!-- Mobile: cards -->
        <ul class="space-y-3 md:hidden">
          {#each visible as person (person.id)}
            {@const status = personStatus(person)}
            <li>
              <button
                type="button"
                class="card w-full text-left hover:border-[var(--color-brand-300)]"
                onclick={() => (selected = person)}
              >
                <span class="flex items-start justify-between gap-3">
                  <span class="font-semibold text-brand-900">{formatName(person)}</span>
                  <span class="pill border text-xs {PERSON_STATUS_CLASS[status]}">
                    {PERSON_STATUS_LABEL[status]}
                  </span>
                </span>
                <span class="mt-2 block space-y-0.5 text-sm text-neutral-700">
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
