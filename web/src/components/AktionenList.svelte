<script lang="ts">
  import { untrack } from 'svelte';
  import { aktionenStore, fetchAktionen } from '../lib/aktionenStore.svelte';
  import { GROUP_LABELS, stufeToFilterKeys, type GroupKey } from '../lib/events';
  import { formatDateRange } from '../lib/dateUtils';
  import { sanitizeDescription } from '../lib/api';
  import type { Aktion } from '../lib/types';

  interface GroupFilter {
    key: string;
    label: string;
    /** Stufe colour, shown as a small dot in front of the name */
    color?: string;
  }

  const STUFE_COLORS: Record<GroupKey, string> = {
    woelflinge: 'var(--color-dpsg-woelflinge)',
    jupfis: 'var(--color-dpsg-jupfis)',
    pfadis: 'var(--color-dpsg-pfadfinder)',
    rover: 'var(--color-dpsg-rover)',
  };

  const GROUP_FILTERS: GroupFilter[] = [
    { key: 'alle', label: 'Alle' },
    ...(Object.entries(GROUP_LABELS) as [GroupKey, string][]).map(([key, label]) => ({
      key,
      label,
      color: STUFE_COLORS[key],
    })),
  ];

  let activeFilter = $state<string>('alle');
  let expandedEvent = $state<string | null>(null);

  function getTodayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  $effect(() => {
    untrack(() => {
      fetchAktionen();
      const params = new URLSearchParams(window.location.search);
      const gruppeParam = params.get('gruppe');
      const validKeys = GROUP_FILTERS.map((f) => f.key);
      if (gruppeParam && validKeys.includes(gruppeParam)) {
        activeFilter = gruppeParam;
      }
    });
  });

  function handleFilterClick(key: string) {
    activeFilter = key;
    const newUrl = new URL(window.location.href);
    if (key === 'alle') {
      newUrl.searchParams.delete('gruppe');
    } else {
      newUrl.searchParams.set('gruppe', key);
    }
    window.history.replaceState({}, '', newUrl);
  }

  function toggleExpand(id: string) {
    expandedEvent = expandedEvent === id ? null : id;
  }

  function isUpcoming(aktion: Aktion): boolean {
    const end = new Date(aktion.end);
    return end >= getTodayStart();
  }

  function matchesFilter(aktion: Aktion): boolean {
    if (activeFilter === 'alle') return true;
    const keys = stufeToFilterKeys(aktion.stufen);
    return keys.includes(activeFilter as GroupKey);
  }

  function isMultiDay(aktion: Aktion): boolean {
    const start = new Date(aktion.start);
    const end = new Date(aktion.end);
    return start.toDateString() !== end.toDateString();
  }

  function isRegistrationOpen(aktion: Aktion): boolean {
    const start = new Date(aktion.start);
    return !Number.isNaN(start.getTime()) && start >= getTodayStart();
  }

  function hasText(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  const filteredAktionen = $derived(
    (aktionenStore.data ?? []).filter((a: Aktion) => isUpcoming(a) && matchesFilter(a))
  );

  const groupedAktionenByMonth = $derived.by(() => {
    const months: { month: string; year: number; events: Aktion[] }[] = [];

    for (const aktion of filteredAktionen) {
      const start = new Date(aktion.start);
      if (Number.isNaN(start.getTime())) continue;

      const month = start.toLocaleDateString('de-DE', { month: 'long' });
      const year = start.getFullYear();
      const lastMonth = months.at(-1);

      if (!lastMonth || lastMonth.month !== month || lastMonth.year !== year) {
        months.push({ month, year, events: [aktion] });
        continue;
      }

      lastMonth.events.push(aktion);
    }

    return months;
  });
</script>

<div class="aktionen-layout">
  <aside id="filter-buttons" class="filters-sidebar">
    <h3 id="filter-heading" class="text-sm font-semibold text-neutral-900">Nach Stufe filtern</h3>
    <div role="group" aria-labelledby="filter-heading" class="filter-group">
      {#each GROUP_FILTERS as filter (filter.key)}
        <button
          type="button"
          class="filter-btn"
          class:active={activeFilter === filter.key}
          aria-pressed={activeFilter === filter.key}
          data-group={filter.key}
          onclick={() => handleFilterClick(filter.key)}
        >
          {#if filter.color}
            <span class="stufe-dot" style:background={filter.color} aria-hidden="true"></span>
          {/if}
          {filter.label}
        </button>
      {/each}
    </div>
    <p
      class="mt-2 text-sm text-neutral-700 tabular-nums md:mt-6 md:border-t md:border-neutral-200 md:pt-4"
    >
      {filteredAktionen.length}
      {filteredAktionen.length === 1 ? 'Termin' : 'Termine'}
    </p>
  </aside>

  <main id="events-list" class="events-main min-w-0">
    {#if aktionenStore.loading}
      <div role="status" aria-live="polite" class="sr-only">Termine werden geladen...</div>
      <div class="space-y-10" aria-hidden="true">
        {#each [1, 2] as i (i)}
          <div>
            <div class="skeleton-element mb-3 h-6 w-32 rounded"></div>
            <div class="divide-y divide-neutral-200 border-y border-neutral-200">
              {#each [1, 2, 3] as j (j)}
                <div class="flex gap-5 py-4">
                  <div class="skeleton-element h-10 w-12 flex-shrink-0 rounded"></div>
                  <div class="flex-1 space-y-2">
                    <div class="skeleton-element h-5 w-48 rounded"></div>
                    <div class="skeleton-element h-4 w-64 max-w-full rounded"></div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else if aktionenStore.error}
      <article
        role="alert"
        class="border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5"
        aria-labelledby="aktionen-error-heading"
      >
        <h3 id="aktionen-error-heading" class="text-lg font-semibold text-brand-900">
          Daten konnten nicht geladen werden
        </h3>
        <p class="mt-1 text-neutral-700">
          Die Termine konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
        </p>
      </article>
    {:else if filteredAktionen.length > 0}
      <div class="space-y-10">
        {#each groupedAktionenByMonth as { month, year, events }, i (`${year}-${month}`)}
          <section aria-labelledby="month-heading-{i}">
            <h2
              id="month-heading-{i}"
              class="border-b-2 border-brand-900 pb-1 font-serif text-xl font-semibold text-brand-900"
            >
              {month}
              {year !== new Date().getFullYear() ? year : ''}
            </h2>
            <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
              {#each events as aktion (aktion.id)}
                {@const filterKeys = stufeToFilterKeys(aktion.stufen)}
                {@const isExpanded = expandedEvent === aktion.id}
                {@const sanitizedDescription = sanitizeDescription(aktion.description ?? '')}
                {@const hasDescription = hasText(sanitizedDescription)}
                {@const hasDetails = hasDescription}
                <li class="event-item">
                  <article
                    class="event-row"
                    class:expanded={isExpanded}
                    data-groups={filterKeys.join(' ')}
                  >
                    <button
                      type="button"
                      class="flex w-full items-start gap-4 py-4 text-left sm:gap-5"
                      onclick={() => hasDetails && toggleExpand(aktion.id)}
                      aria-expanded={isExpanded}
                      disabled={!hasDetails}
                    >
                      <!-- Date as on a calendar page; the full date follows as text -->
                      <span class="w-12 flex-shrink-0 text-center" aria-hidden="true">
                        <span
                          class="block text-2xl leading-none font-semibold text-brand-900 tabular-nums"
                        >
                          {new Date(aktion.start).getDate()}
                        </span>
                        <span
                          class="mt-1 block text-xs font-semibold text-[var(--color-dpsg-red)] uppercase"
                        >
                          {new Date(aktion.start).toLocaleDateString('de-DE', { month: 'short' })}
                        </span>
                      </span>

                      <span class="block min-w-0 flex-1">
                        <h3 class="text-lg leading-snug font-semibold text-brand-900">
                          {aktion.title}
                        </h3>
                        <span class="mt-1 block text-sm text-neutral-700">
                          {formatDateRange(aktion)}
                          {#if isMultiDay(aktion)}
                            <span aria-hidden="true">·</span> mehrtägig
                          {/if}
                        </span>
                        {#if filterKeys.length > 0}
                          <span
                            class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-900"
                          >
                            {#each filterKeys as key (key)}
                              <span class="inline-flex items-center gap-1.5">
                                <span
                                  class="stufe-dot"
                                  style:background={STUFE_COLORS[key]}
                                  aria-hidden="true"
                                ></span>
                                {GROUP_LABELS[key]}
                              </span>
                            {/each}
                          </span>
                        {/if}
                      </span>

                      {#if hasDetails}
                        <svg
                          class="mt-1 h-5 w-5 flex-shrink-0 text-brand-900 transition-transform duration-200"
                          class:rotate-180={isExpanded}
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      {/if}
                    </button>

                    {#if isExpanded && hasDetails}
                      <div class="event-details pb-5 pl-16 sm:pl-[4.25rem]">
                        {#if hasDescription}
                          <div class="description max-w-prose text-neutral-900">
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeDescription -->
                            {@html sanitizedDescription}
                          </div>
                        {/if}
                        {#if aktion.campflow_link && isRegistrationOpen(aktion)}
                          <a
                            href={aktion.campflow_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="btn-primary mt-4"
                          >
                            Zur Anmeldung
                            <span class="sr-only">(öffnet in neuem Tab)</span>
                            <svg
                              class="h-4 w-4"
                              aria-hidden="true"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        {/if}
                      </div>
                    {/if}
                  </article>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {:else}
      <p class="border-y border-neutral-200 py-6 text-neutral-700">
        Aktuell sind keine bevorstehenden Termine vorhanden.
      </p>
    {/if}
  </main>
</div>

<style>
  .aktionen-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  .filter-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.25rem;
    margin-top: 0.25rem;
  }

  @media (min-width: 768px) {
    .aktionen-layout {
      grid-template-columns: 180px 1fr;
      gap: 2.5rem;
    }

    .filters-sidebar {
      position: sticky;
      top: 1rem;
      align-self: start;
    }

    .filter-group {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  /* Text switch: the active filter is underlined – no pill, no filled box */
  .filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    font-size: 1rem;
    text-align: left;
    color: var(--color-neutral-700);
    text-decoration-line: underline;
    text-decoration-color: transparent;
    text-decoration-thickness: 2px;
    text-underline-offset: 0.35em;
  }

  @media (hover: hover) {
    .filter-btn:hover {
      color: var(--color-brand-900);
      text-decoration-color: var(--color-neutral-300);
    }
  }

  .filter-btn.active {
    color: var(--color-brand-900);
    font-weight: 600;
    text-decoration-color: var(--color-dpsg-red);
  }

  .stufe-dot {
    display: inline-block;
    flex: none;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 9999px;
  }

  .event-row button:disabled {
    cursor: default;
  }

  @media (hover: hover) {
    .event-row button:enabled:hover h3 {
      text-decoration: underline;
      text-decoration-color: var(--color-neutral-300);
      text-underline-offset: 0.2em;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }

  .description :global(p) {
    margin-bottom: 0.5rem;
  }

  .description :global(p:last-child) {
    margin-bottom: 0;
  }

  .description :global(b),
  .description :global(strong) {
    font-weight: 600;
  }
</style>
