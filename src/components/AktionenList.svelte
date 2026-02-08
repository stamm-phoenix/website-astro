<script lang="ts">
  import { untrack } from "svelte";
  import { aktionenStore, fetchAktionen } from "../lib/aktionenStore.svelte";
  import {
    GROUP_EMOJIS,
    GROUP_LABELS,
    GROUP_AGE_RANGES,
    stufeToFilterKeys,
    type GroupKey,
  } from "../lib/events";
  import { formatDateRange } from "../lib/dateUtils";
  import { sanitizeDescription } from "../lib/api";
  import type { Aktion } from "../lib/types";

  const GROUP_FILTERS = [
    { key: "alle", label: "Alle" },
    ...Object.entries(GROUP_LABELS).map(([key, label]: [string, string]) => ({
      key,
      label: `${GROUP_EMOJIS[key as GroupKey]} ${label}`,
    })),
  ];

  let activeFilter = $state<string>("alle");
  let expandedEvent = $state<string | null>(null);

  function getTodayStart(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  $effect(() => {
    untrack(() => {
      fetchAktionen();
      const params = new URLSearchParams(window.location.search);
      const gruppeParam = params.get("gruppe");
      const validKeys = GROUP_FILTERS.map((f: { key: string; label: string }) => f.key);
      if (gruppeParam && validKeys.includes(gruppeParam)) {
        activeFilter = gruppeParam;
      }
    });
  });

  function handleFilterClick(key: string) {
    activeFilter = key;
    const newUrl = new URL(window.location.href);
    if (key === "alle") {
      newUrl.searchParams.delete("gruppe");
    } else {
      newUrl.searchParams.set("gruppe", key);
    }
    window.history.replaceState({}, "", newUrl);
  }

  function toggleExpand(id: string) {
    expandedEvent = expandedEvent === id ? null : id;
  }

  function isUpcoming(aktion: Aktion): boolean {
    const end = new Date(aktion.end);
    return end >= getTodayStart();
  }

  function matchesFilter(aktion: Aktion): boolean {
    if (activeFilter === "alle") return true;
    const keys = stufeToFilterKeys(aktion.stufen);
    return keys.includes(activeFilter as GroupKey);
  }

  function isMultiDay(aktion: Aktion): boolean {
    const start = new Date(aktion.start);
    const end = new Date(aktion.end);
    return start.toDateString() !== end.toDateString();
  }

  const filteredAktionen = $derived(
    (aktionenStore.data ?? []).filter((a: Aktion) => isUpcoming(a) && matchesFilter(a)),
  );

  const nextThreeMonths = $derived.by(() => {
    const now = new Date();
    const months: { month: string; year: number; events: Aktion[] }[] = [];
    
    for (let i = 0; i < 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthName = date.toLocaleDateString("de-DE", { month: "long" });
      const year = date.getFullYear();
      
      const events = filteredAktionen.filter((a: Aktion) => {
        const start = new Date(a.start);
        return start.getMonth() === date.getMonth() && start.getFullYear() === year;
      });
      
      if (events.length > 0) {
        months.push({ month: monthName, year, events });
      }
    }
    return months;
  });
</script>

<div class="aktionen-layout">
  <aside id="filter-buttons" class="filters-sidebar">
    <h3 id="filter-heading" class="text-xs font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide mb-3">
      Nach Stufe filtern
    </h3>
    <div role="group" aria-labelledby="filter-heading" class="flex flex-col gap-1.5">
      {#each GROUP_FILTERS as filter}
        <button
          type="button"
          class="filter-btn text-left px-3 py-2 rounded-md text-sm transition-all duration-150"
          class:active={activeFilter === filter.key}
          aria-pressed={activeFilter === filter.key}
          data-group={filter.key}
          onclick={() => handleFilterClick(filter.key)}
        >
          {filter.label}
        </button>
      {/each}
    </div>
    
    <div class="mt-6 pt-6 border-t border-[var(--color-neutral-200)]">
      <p class="text-xs text-[var(--color-neutral-600)]">
        <strong>{filteredAktionen.length}</strong> {filteredAktionen.length === 1 ? 'Termin' : 'Termine'}
      </p>
    </div>
  </aside>

  <main id="events-list" class="events-main">
    {#if aktionenStore.loading}
      <div role="status" aria-live="polite" class="sr-only">
        Termine werden geladen...
      </div>
      <div class="space-y-8">
        {#each [1, 2] as _}
          <div>
            <div class="skeleton-element h-6 w-32 rounded mb-4"></div>
            <div class="grid gap-3">
              {#each [1, 2, 3] as __}
                <div class="event-card surface p-4">
                  <div class="flex gap-4">
                    <div class="skeleton-element w-14 h-14 rounded-md flex-shrink-0"></div>
                    <div class="flex-1 space-y-2">
                      <div class="skeleton-element h-5 w-48 rounded"></div>
                      <div class="skeleton-element h-4 w-32 rounded"></div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else if aktionenStore.error}
      <article role="alert" class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]" aria-labelledby="aktionen-error-heading">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-dpsg-red)]/10 flex items-center justify-center">
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
            <h3 id="aktionen-error-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
              Daten konnten nicht geladen werden
            </h3>
            <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
              Die Termine konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
            </p>
          </div>
        </div>
      </article>
    {:else if filteredAktionen.length > 0}
      <div class="space-y-8">
        {#each nextThreeMonths as { month, year, events }, i}
          <section aria-labelledby="month-heading-{i}">
            <h2 id="month-heading-{i}" class="text-lg font-serif font-semibold text-[var(--color-brand-900)] mb-4 flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-500)]" aria-hidden="true"></span>
              {month} {year !== new Date().getFullYear() ? year : ''}
            </h2>
            <ul class="grid gap-3">
              {#each events as aktion (aktion.id)}
                {@const filterKeys = stufeToFilterKeys(aktion.stufen)}
                {@const isExpanded = expandedEvent === aktion.id}
                {@const hasDetails = aktion.description || aktion.campflow_link}
                <li class="event-item">
                  <article 
                    class="event-card surface overflow-hidden transition-all duration-200"
                    class:expanded={isExpanded}
                    data-groups={filterKeys.join(" ")}
                  >
                    <button
                      type="button"
                      class="w-full text-left p-4 flex gap-4 items-start"
                      onclick={() => hasDetails && toggleExpand(aktion.id)}
                      aria-expanded={isExpanded}
                      disabled={!hasDetails}
                    >
                      <div class="date-badge flex-shrink-0 w-14 h-14 rounded-md bg-gradient-to-br from-[var(--color-brand-50)] to-white border border-[var(--color-neutral-200)] flex flex-col items-center justify-center">
                        <span class="text-xs font-semibold text-[var(--color-accent-500)] uppercase">
                          {new Date(aktion.start).toLocaleDateString("de-DE", { month: "short" })}
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
                          {#each filterKeys as key}
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-800)]">
                              {GROUP_EMOJIS[key]} {GROUP_LABELS[key]}
                            </span>
                          {/each}
                          {#if isMultiDay(aktion)}
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]">
                              Mehrtägig
                            </span>
                          {/if}
                        </div>
                      </div>
                      
                      {#if hasDetails}
                        <div class="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center transition-transform duration-200" class:rotate-180={isExpanded}>
                          <svg class="w-4 h-4 text-[var(--color-brand-700)]" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      {/if}
                    </button>
                    
                    {#if isExpanded && hasDetails}
                      <div class="event-details px-4 pb-4 pt-0 border-t border-[var(--color-neutral-100)] mt-0">
                        <div class="ml-[4.5rem]">
                          {#if aktion.description}
                            <div class="description text-sm text-[var(--color-neutral-700)] mt-3">
                              {@html sanitizeDescription(aktion.description)}
                            </div>
                          {/if}
                          {#if aktion.campflow_link}
                            <a
                              href={aktion.campflow_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-[var(--color-accent-500)] text-white text-sm font-semibold shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200"
                            >
                              Zur Anmeldung
                              <span class="sr-only">(öffnet in neuem Tab)</span>
                              <svg class="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          {/if}
                        </div>
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
      <div class="surface p-8 text-center" aria-labelledby="no-events-heading">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center">
          <svg class="w-8 h-8 text-[var(--color-brand-300)]" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p id="no-events-heading" class="text-[var(--color-neutral-700)]">
          Aktuell sind keine bevorstehenden Termine vorhanden.
        </p>
      </div>
    {/if}
  </main>
</div>

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
    position: sticky;
    top: 1rem;
    align-self: start;
  }

  @media (max-width: 767px) {
    .filters-sidebar {
      position: static;
      background: var(--color-neutral-50);
      padding: 1rem;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-neutral-200);
    }
    
    .filters-sidebar > div[role="group"] {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }

  .filter-btn {
    color: var(--color-neutral-700);
    background: transparent;
  }

  .filter-btn:hover {
    background: var(--color-brand-50);
    color: var(--color-brand-900);
  }

  .filter-btn.active {
    background: var(--color-brand-900);
    color: white;
  }

  .event-card {
    border-left: 3px solid var(--color-neutral-200);
  }

  .event-card:hover {
    border-left-color: var(--color-accent-500);
  }

  .event-card.expanded {
    border-left-color: var(--color-accent-500);
    box-shadow: var(--shadow-lift);
  }

  .event-card button:disabled {
    cursor: default;
  }

  .skeleton-element {
    background: linear-gradient(
      110deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 40%,
      var(--color-neutral-200) 60%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
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
