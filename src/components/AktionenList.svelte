<script lang="ts">
  import { onMount } from "svelte";
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
      label: `${GROUP_EMOJIS[key as GroupKey]} ${label} (${GROUP_AGE_RANGES[key as GroupKey]})`,
    })),
  ];

  let activeFilter = $state<string>("alle");

  function getTodayStart(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  onMount(() => {
    fetchAktionen();
    const params = new URLSearchParams(window.location.search);
    const gruppeParam = params.get("gruppe");
    const validKeys = GROUP_FILTERS.map((f) => f.key);
    if (gruppeParam && validKeys.includes(gruppeParam)) {
      activeFilter = gruppeParam;
    }
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

  function isUpcoming(aktion: Aktion): boolean {
    const end = new Date(aktion.end);
    return end >= getTodayStart();
  }

  function matchesFilter(aktion: Aktion): boolean {
    if (activeFilter === "alle") return true;
    const keys = stufeToFilterKeys(aktion.stufen);
    return keys.includes(activeFilter as GroupKey);
  }

  const filteredAktionen = $derived(
    (aktionenStore.data ?? []).filter((a: Aktion) => isUpcoming(a) && matchesFilter(a)),
  );
</script>

<h3 id="filter-heading" class="sr-only">Termine nach Gruppe filtern</h3>
<div role="group" aria-labelledby="filter-heading" class="flex flex-wrap gap-2 text-sm" id="filter-buttons">
  {#each GROUP_FILTERS as filter}
    <button
      type="button"
      class="filter-btn inline-flex items-center rounded-full border border-[var(--color-neutral-200)] bg-white px-3.5 py-1.5 text-[var(--color-neutral-800)] shadow-soft hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition duration-100"
      class:active={activeFilter === filter.key}
      aria-pressed={activeFilter === filter.key}
      data-group={filter.key}
      onclick={() => handleFilterClick(filter.key)}
    >
      {filter.label}
    </button>
  {/each}
</div>

<div class="mt-6">
  {#if aktionenStore.loading}
    <div role="status" aria-live="polite" class="sr-only">
      Termine werden geladen...
    </div>
    <ul class="grid gap-6 md:grid-cols-2">
      {#each [1, 2, 3, 4] as _}
        <li class="skeleton-card surface p-5 border-l-4 border-l-[var(--color-neutral-300)]">
          <div class="flex flex-col gap-2">
            <div class="skeleton-element h-6 w-48 rounded"></div>
            <div class="skeleton-element h-4 w-32 rounded"></div>
            <div class="skeleton-element h-4 w-24 rounded"></div>
            <div class="pt-1 flex gap-3">
              <div class="skeleton-element h-4 w-20 rounded"></div>
            </div>
          </div>
        </li>
      {/each}
    </ul>
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
            Die Termine konnten leider nicht abgerufen werden. Bitte versuchen Sie es später erneut.
          </p>
        </div>
      </div>
    </article>
  {:else if filteredAktionen.length > 0}
    <ul class="grid gap-6 md:grid-cols-2" id="events-list">
      {#each filteredAktionen as aktion (aktion.id)}
        {@const filterKeys = stufeToFilterKeys(aktion.stufen)}
        {@const groupLabel = filterKeys
          .map((key: GroupKey) => `${GROUP_EMOJIS[key]} ${GROUP_LABELS[key]}`)
          .join("\n")}
        <li
          class="event-item surface p-5 border-l-4 border-l-[var(--color-accent-500)]"
          data-groups={filterKeys.join(" ")}
        >
          <div class="flex flex-col gap-2">
            <h3 class="text-lg font-semibold text-[var(--color-brand-900)]">{aktion.title}</h3>
            <p class="text-sm text-[var(--color-neutral-700)]">{formatDateRange(aktion)}</p>
            {#if groupLabel}
              <p class="text-sm text-[var(--color-neutral-700)] whitespace-pre-line">{groupLabel}</p>
            {/if}
            {#if aktion.description}
              <div class="description text-sm text-[var(--color-neutral-700)]">
                {@html sanitizeDescription(aktion.description)}
              </div>
            {/if}
            <div class="pt-1 flex gap-3">
              {#if aktion.campflow_link}
                <a
                  href={aktion.campflow_link}
                  class="text-sm font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] underline underline-offset-2"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Anmeldung
                </a>
              {/if}
              <a
                href={`/aktionen/${aktion.id}`}
                class="text-sm font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] underline underline-offset-2"
              >
                Mehr Infos
              </a>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="surface p-4">
      Aktuell sind keine bevorstehenden Termine vorhanden.
    </p>
  {/if}
</div>

<style>
  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
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

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.85;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-card {
      animation: none;
    }

    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }

  .filter-btn.active {
    border-color: var(--color-accent-500);
    background-color: var(--color-brand-50);
    color: var(--color-brand-900);
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
