<script lang="ts">
  import FilterTabs from './ui/FilterTabs.svelte';
  import { untrack } from 'svelte';
  import { aktionenStore, fetchAktionen } from '../lib/aktionenStore.svelte';
  import { GROUP_EMOJIS, GROUP_LABELS, stufeToFilterKeys, type GroupKey } from '../lib/events';
  import { formatDateRange, localDate } from '../lib/dateUtils';
  import { sanitizeDescription } from '../lib/api';
  import type { Aktion, CalendarItem } from '../lib/types';
  import { withBaked } from '../lib/storeView';
  import MonthGrid from './MonthGrid.svelte';

  /** An Aktion as shown in the month grid. */
  interface AktionItem extends CalendarItem {
    aktion: Aktion;
  }

  type ViewMode = 'liste' | 'monat';

  interface Props {
    /** Baked at build time; refreshed from the API in the browser */
    initial?: Aktion[] | null;
    /** Time of the build: the baked list is rendered as of then, the browser uses today */
    builtAt?: number;
  }
  let { initial = null, builtAt = undefined }: Props = $props();

  const view = $derived(withBaked(aktionenStore, initial));
  // Same date as the prerendered HTML while hydrating; switches to today right after
  let now = $state(untrack(() => (builtAt === undefined ? new Date() : new Date(builtAt))));

  const GROUP_FILTERS = [
    { key: 'alle', label: 'Alle' },
    ...Object.entries(GROUP_LABELS).map(([key, label]: [string, string]) => ({
      key,
      label: `${GROUP_EMOJIS[key as GroupKey]} ${label}`,
    })),
  ];

  let activeFilter = $state<string>('alle');
  let viewMode = $state<ViewMode>('liste');
  /** Month of the grid view as `YYYY-MM`. */
  let month = $state('');
  let expandedEvent = $state<string | null>(null);

  function getTodayStart(): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  $effect(() => {
    untrack(() => {
      now = new Date();
      fetchAktionen();
      const params = new URLSearchParams(window.location.search);
      const gruppeParam = params.get('gruppe');
      const validKeys = GROUP_FILTERS.map((f: { key: string; label: string }) => f.key);
      if (gruppeParam && validKeys.includes(gruppeParam)) {
        activeFilter = gruppeParam;
      }
      if (params.get('ansicht') === 'monat') {
        const monthParam = params.get('monat');
        month =
          monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : currentMonth();
        viewMode = 'monat';
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

  function currentMonth(): string {
    return localDate(now).slice(0, 7);
  }

  /** Keeps view and month in the address, so links and reloads show the same. */
  function updateViewUrl(): void {
    const url = new URL(window.location.href);
    if (viewMode === 'monat') url.searchParams.set('ansicht', 'monat');
    else url.searchParams.delete('ansicht');
    if (viewMode === 'monat' && month !== currentMonth()) url.searchParams.set('monat', month);
    else url.searchParams.delete('monat');
    window.history.replaceState({}, '', url);
  }

  function selectViewMode(value: ViewMode): void {
    if (value === 'monat' && viewMode !== 'monat') month = currentMonth();
    viewMode = value;
    updateViewUrl();
  }

  function selectMonth(value: string): void {
    month = value;
    updateViewUrl();
  }

  /** Bar colours per Stufe; written out in full so Tailwind generates them. */
  const GROUP_BAR_CLASSES: Record<GroupKey, string> = {
    woelflinge:
      'stufe-marker bg-[var(--color-dpsg-woelflinge)] text-[var(--color-dpsg-blue)] border-transparent',
    jupfis: 'stufe-marker bg-[var(--color-dpsg-jupfis)] text-white border-transparent',
    pfadis: 'stufe-marker bg-[var(--color-dpsg-pfadfinder)] text-white border-transparent',
    rover: 'stufe-marker bg-[var(--color-dpsg-rover)] text-white border-transparent',
  };
  const SHARED_BAR_CLASS = 'bg-[var(--color-dpsg-blue)] text-white border-transparent';

  /** Bars take the colour of their Stufe; Aktionen for several Stufen are DPSG blue. */
  function barClass(item: AktionItem): string {
    const keys = stufeToFilterKeys(item.aktion.stufen);
    return keys.length === 1 ? GROUP_BAR_CLASSES[keys[0]!] : SHARED_BAR_CLASS;
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

  /** All Aktionen of the chosen Stufe, past ones included, for the month grid. */
  const calendarItems = $derived(
    (view.data ?? []).filter(matchesFilter).map((aktion: Aktion): AktionItem => ({
      key: aktion.id,
      title: aktion.title,
      start: aktion.start || null,
      end: aktion.end || null,
      aktion,
    }))
  );

  const filteredAktionen = $derived(
    (view.data ?? []).filter((a: Aktion) => isUpcoming(a) && matchesFilter(a))
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
    <div class="filters-header">
      <h3 id="filter-heading" class="text-xs font-semibold text-[var(--color-neutral-600)]">
        Nach Stufe filtern
      </h3>
      <span class="filter-count">
        <strong>{filteredAktionen.length}</strong>
        {filteredAktionen.length === 1 ? 'Termin' : 'Termine'}
      </span>
    </div>
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
          <span class="filter-label">{filter.label}</span>
        </button>
      {/each}
    </div>

    <div class="filter-footer">
      <p class="text-xs text-[var(--color-neutral-600)]">
        <strong>{filteredAktionen.length}</strong>
        {filteredAktionen.length === 1 ? 'Termin' : 'Termine'}
      </p>
    </div>
  </aside>

  <div id="events-list" class="events-main min-w-0">
    <div class="mb-6 flex justify-end">
      <FilterTabs
        label="Ansicht"
        options={[
          { value: 'liste', label: 'Liste' },
          { value: 'monat', label: 'Monat' },
        ]}
        value={viewMode}
        onselect={selectViewMode}
      />
    </div>

    {#if view.loading}
      <div role="status" aria-live="polite" class="sr-only">Termine werden geladen...</div>
      <div class="space-y-8">
        {#each [1, 2] as i (i)}
          <div>
            <div class="skeleton-element h-6 w-32 rounded mb-4"></div>
            <div class="divide-y divide-neutral-200 border-y border-neutral-200">
              {#each [1, 2, 3] as j (j)}
                <div class="event-card surface p-4 border-l-3 border-l-[var(--color-neutral-200)]">
                  <div class="flex gap-4">
                    <div class="skeleton-element w-14 h-14 rounded-md flex-shrink-0"></div>
                    <div class="flex-1 space-y-2">
                      <div class="skeleton-element h-5 w-48 rounded"></div>
                      <div class="skeleton-element h-4 w-32 rounded"></div>
                      <div class="flex gap-1.5 mt-2">
                        <div class="skeleton-element h-5 w-20 rounded"></div>
                        <div class="skeleton-element h-5 w-24 rounded"></div>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else if view.error}
      <article
        role="alert"
        class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]"
        aria-labelledby="aktionen-error-heading"
      >
        <div class="flex items-start gap-4">
          <div
            class="flex-shrink-0 w-10 h-10 rounded-sm bg-[var(--color-dpsg-red)]/10 flex items-center justify-center"
          >
            <svg
              aria-hidden="true"
              class="w-5 h-5 text-[var(--color-dpsg-red)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3
              id="aktionen-error-heading"
              class="text-lg font-semibold text-[var(--color-brand-900)]"
            >
              Daten konnten nicht geladen werden
            </h3>
            <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
              Die Termine konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
            </p>
          </div>
        </div>
      </article>
    {:else if viewMode === 'monat'}
      <MonthGrid
        rows={calendarItems}
        {month}
        onmonth={selectMonth}
        card={gridCard}
        {barClass}
        {legend}
      />
    {:else if filteredAktionen.length > 0}
      <div class="space-y-8">
        {#each groupedAktionenByMonth as { month, year, events }, i (`${year}-${month}`)}
          <section aria-labelledby="month-heading-{i}">
            <h2
              id="month-heading-{i}"
              class="text-lg font-serif font-semibold text-[var(--color-brand-900)] mb-4 flex items-center gap-2"
            >
              <span class="w-1.5 h-1.5 rounded-sm bg-[var(--color-accent-500)]" aria-hidden="true"
              ></span>
              {month}
              {year !== now.getFullYear() ? year : ''}
            </h2>
            <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
              {#each events as aktion (aktion.id)}
                {@render card(aktion)}
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {:else}
      <div class="surface p-8 text-center" aria-labelledby="no-events-heading">
        <div
          class="w-16 h-16 mx-auto mb-4 rounded-sm bg-[var(--color-brand-50)] flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-[var(--color-brand-300)]"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <p id="no-events-heading" class="text-[var(--color-neutral-700)]">
          Aktuell sind keine bevorstehenden Termine vorhanden.
        </p>
      </div>
    {/if}
  </div>
</div>

{#snippet legend()}
  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700" aria-label="Legende">
    {#each Object.entries(GROUP_LABELS) as [key, label] (key)}
      <li class="flex items-center gap-1.5">
        <span
          class="inline-block size-3 shrink-0 rounded-sm {GROUP_BAR_CLASSES[key as GroupKey]}"
          aria-hidden="true"
        ></span>
        {label}
      </li>
    {/each}
    <li class="flex items-center gap-1.5">
      <span class="inline-block size-3 shrink-0 rounded-sm {SHARED_BAR_CLASS}" aria-hidden="true"
      ></span>
      Mehrere Stufen
    </li>
  </ul>
{/snippet}

{#snippet gridCard(item: AktionItem)}
  {@render card(item.aktion)}
{/snippet}

{#snippet card(aktion: Aktion)}
  {@const filterKeys = stufeToFilterKeys(aktion.stufen)}
  {@const isExpanded = expandedEvent === aktion.id}
  {@const sanitizedDescription = sanitizeDescription(aktion.description ?? '')}
  {@const hasDescription = hasText(sanitizedDescription)}
  {@const hasRegistrationLink = hasText(aktion.campflow_link) && isRegistrationOpen(aktion)}
  {@const hasDetails = hasDescription || hasRegistrationLink}
  <li class="event-item">
    <article
      class="event-card overflow-hidden py-4"
      class:expanded={isExpanded}
      data-groups={filterKeys.join(' ')}
    >
      <button
        type="button"
        class="w-full text-left p-4 flex gap-4 items-start"
        onclick={() => hasDetails && toggleExpand(aktion.id)}
        aria-expanded={isExpanded}
        disabled={!hasDetails}
      >
        <div
          class="date-badge flex-shrink-0 w-14 h-14 rounded-md bg-neutral-100 border border-[var(--color-neutral-200)] flex flex-col items-center justify-center"
        >
          <span class="text-xs font-semibold text-brand-900">
            {new Date(aktion.start).toLocaleDateString('de-DE', { month: 'short' })}
          </span>
          <span class="text-xl font-bold text-[var(--color-brand-900)] leading-none">
            {new Date(aktion.start).getDate()}
          </span>
        </div>

        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-[var(--color-brand-900)] leading-snug">
            {aktion.title}
          </h3>
          <p class="text-sm text-[var(--color-neutral-700)] mt-1">
            {formatDateRange(aktion)}
          </p>
          <div class="flex flex-wrap gap-1.5 mt-2">
            {#each filterKeys as key (key)}
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
              >
                {GROUP_EMOJIS[key]}
                {GROUP_LABELS[key]}
              </span>
            {/each}
            {#if isMultiDay(aktion)}
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]"
              >
                Mehrtägig
              </span>
            {/if}
          </div>
        </div>

        {#if hasDetails}
          <div
            class="flex-shrink-0 w-6 h-6 rounded-sm bg-[var(--color-brand-50)] flex items-center justify-center transition-transform duration-200"
            class:rotate-180={isExpanded}
          >
            <svg
              class="w-4 h-4 text-[var(--color-brand-700)]"
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
          </div>
        {/if}
      </button>

      {#if isExpanded && hasDetails}
        <div class="event-details px-4 pb-4 pt-0 border-t border-[var(--color-neutral-100)] mt-0">
          <div class="ml-[4.5rem]">
            {#if hasDescription}
              <div class="description text-sm text-[var(--color-neutral-700)] mt-3">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeDescription -->
                {@html sanitizedDescription}
              </div>
            {/if}
            {#if hasRegistrationLink}
              <a
                href={aktion.campflow_link}
                target="_blank"
                rel="noopener noreferrer"
                class="btn-primary mt-4 w-fit"
              >
                Zur Anmeldung
                <span class="sr-only">(öffnet in neuem Tab)</span>
                <svg
                  class="w-4 h-4"
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
        </div>
      {/if}
    </article>
  </li>
{/snippet}

<style>
  .aktionen-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }

  @media (min-width: 768px) {
    .aktionen-layout {
      grid-template-columns: 200px 1fr;
      gap: 2rem;
    }
  }

  .filters-sidebar {
    align-self: start;
  }
  .filters-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .filter-count {
    font-size: 0.875rem;
    color: var(--color-neutral-700);
  }
  .filter-footer {
    display: none;
  }
  .filter-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
  }
  .filter-btn {
    min-height: 2.75rem;
    padding: 0.5rem 0;
    text-align: left;
    font-size: 0.875rem;
    color: var(--color-neutral-700);
    text-decoration: underline 2px transparent;
    text-underline-offset: 0.35em;
  }
  .filter-btn.active {
    color: var(--color-brand-900);
    font-weight: 600;
    text-decoration-color: var(--color-accent-500);
  }
  @media (hover: hover) {
    .filter-btn:hover {
      color: var(--color-brand-900);
      text-decoration-color: var(--color-neutral-300);
    }
  }
  @media (min-width: 768px) {
    .filters-sidebar {
      position: sticky;
      top: 8rem;
    }
    .filters-header {
      display: block;
    }
    .filter-count {
      display: block;
      margin-top: 0.5rem;
    }
    .filter-group {
      flex-direction: column;
      margin-top: 0.75rem;
    }
  }

  .event-card {
    border-left: 3px solid var(--color-neutral-200);
  }

  .event-card:hover {
    border-left-color: var(--color-accent-500);
  }

  .event-card.expanded {
    border-left-color: var(--color-accent-500);
  }

  .event-card button:disabled {
    cursor: default;
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
