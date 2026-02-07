<script lang="ts">
  import { onMount } from "svelte";

  interface FilterOption {
    key: string;
    label: string;
  }

  interface Props {
    filters: FilterOption[];
    defaultActive?: string;
  }

  let { filters, defaultActive = "alle" }: Props = $props();

  // Use a local variable to track active filter state
  let activeFilter = $state<string>(defaultActive);

  onMount(() => {
    // Check URL params on mount (overrides defaultActive if present)
    const params = new URLSearchParams(window.location.search);
    const gruppeParam = params.get("gruppe");
    // Validate that gruppeParam is in the supported filter list
    const validKeys = filters.map((f) => f.key);
    if (gruppeParam && validKeys.includes(gruppeParam)) {
      activeFilter = gruppeParam;
    } else {
      activeFilter = defaultActive;
    }
    // Apply initial filter
    applyFilter(activeFilter);
  });

  function applyFilter(group: string) {
    const eventCards = document.querySelectorAll<HTMLElement>(".event-item");
    eventCards.forEach((card) => {
      const groups = (card.dataset.groups || "")
        .split(" ")
        .map((value) => value.trim())
        .filter(Boolean);
      const isVisible = group === "alle" || groups.includes(group);
      card.classList.toggle("hidden", !isVisible);
    });
  }

  function handleFilterClick(key: string) {
    activeFilter = key;
    applyFilter(key);

    // Update URL
    const newUrl = new URL(window.location.href);
    if (key === "alle") {
      newUrl.searchParams.delete("gruppe");
    } else {
      newUrl.searchParams.set("gruppe", key);
    }
    window.history.replaceState({}, "", newUrl);
  }
</script>

<div class="mt-4 flex flex-wrap gap-2 text-sm" id="filter-buttons">
  {#each filters as filter}
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

<style>
  .filter-btn.active {
    border-color: var(--color-accent-500);
    background-color: var(--color-brand-50);
    color: var(--color-brand-900);
  }
</style>
