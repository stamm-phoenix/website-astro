<script lang="ts">
  import { onMount, untrack } from 'svelte';

  interface FilterOption {
    key: string;
    label: string;
  }

  interface Props {
    filters: FilterOption[];
    defaultActive?: string;
  }

  let { filters, defaultActive = 'alle' }: Props = $props();

  // The default initializes the filter; later choices are owned by this component.
  let activeFilter = $state<string>(untrack(() => defaultActive));

  onMount(() => {
    // Check URL params on mount (overrides defaultActive if present)
    const params = new URLSearchParams(window.location.search);
    const gruppeParam = params.get('gruppe');
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
    const eventCards = document.querySelectorAll<HTMLElement>('.event-item');
    eventCards.forEach((card) => {
      const groups = (card.dataset.groups || '')
        .split(' ')
        .map((value) => value.trim())
        .filter(Boolean);
      const isVisible = group === 'alle' || groups.includes(group);
      card.classList.toggle('hidden', !isVisible);
    });
  }

  function handleFilterClick(key: string) {
    activeFilter = key;
    applyFilter(key);

    // Update URL
    const newUrl = new URL(window.location.href);
    if (key === 'alle') {
      newUrl.searchParams.delete('gruppe');
    } else {
      newUrl.searchParams.set('gruppe', key);
    }
    window.history.replaceState({}, '', newUrl);
  }
</script>

<div
  role="group"
  aria-label="Termine nach Gruppe filtern"
  class="mt-4 flex flex-wrap gap-x-5"
  id="filter-buttons"
>
  {#each filters as filter (filter.key)}
    <button
      type="button"
      class="filter-btn"
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
  /* Text switch: the active filter is underlined – no pill */
  .filter-btn {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
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
</style>
