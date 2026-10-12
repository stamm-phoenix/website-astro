<script lang="ts" generics="T extends string">
  import { onMount, tick } from 'svelte';
  interface Option {
    value: T;
    label: string;
    count?: number;
  }
  interface Props {
    label: string;
    options: readonly Option[];
    value: T;
    onselect: (value: T) => void;
    class?: string;
    scrollable?: boolean;
  }
  let {
    label,
    options,
    value,
    onselect,
    class: className = '',
    scrollable = false,
  }: Props = $props();
  const instanceId = $props.id();
  let list = $state<HTMLDivElement | null>(null);
  let left = $state(false);
  let right = $state(false);
  /** Show scroll hints only on edges where there are more options to discover. */
  function updateEdges(): void {
    left = !!list && list.scrollLeft > 1;
    right = !!list && list.scrollWidth - list.clientWidth - list.scrollLeft > 1;
  }
  /** Reveal the active option inside the strip without moving the page vertically. */
  function revealSelected(): void {
    const button = list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!button || !list) return;
    const box = button.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (box.left < viewport.left + 16) list.scrollLeft += box.left - viewport.left - 16;
    else if (box.right > viewport.right - 16) list.scrollLeft += box.right - viewport.right + 16;
    updateEdges();
  }
  onMount(() => {
    if (!list || !scrollable) return;
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    revealSelected();
    return () => observer.disconnect();
  });
  $effect(() => {
    const selected = value;
    if (!scrollable || !list || !selected) return;
    void tick().then(revealSelected);
  });
</script>

{#snippet tabButtons()}
  {#each options as option (option.value)}
    <button
      type="button"
      class="filter-tab"
      aria-pressed={value === option.value}
      aria-describedby={option.count !== undefined
        ? `${instanceId}-${option.value}-count`
        : undefined}
      onclick={() => onselect(option.value)}
    >
      {option.label}{#if option.count !== undefined}<span
          aria-hidden="true"
          class="ml-1 tabular-nums">({option.count})</span
        >{/if}
    </button>
    {#if option.count !== undefined}<span id="{instanceId}-{option.value}-count" class="sr-only"
        >{option.count} {option.count === 1 ? 'Eintrag' : 'Einträge'}</span
      >{/if}
  {/each}
{/snippet}
{#if scrollable}
  <div class="relative min-w-0 {className}">
    <div
      bind:this={list}
      role="group"
      aria-label={label}
      onscroll={updateEdges}
      class="tab-scroll flex flex-nowrap gap-5 overflow-x-auto"
    >
      {@render tabButtons()}
    </div>
    {#if left}<span aria-hidden="true" class="tab-fade tab-fade-left"></span>{/if}
    {#if right}<span aria-hidden="true" class="tab-fade tab-fade-right"></span>{/if}
  </div>
{:else}
  <div role="group" aria-label={label} class={`flex flex-wrap gap-x-5 gap-y-1 ${className}`}>
    {@render tabButtons()}
  </div>
{/if}

<style>
  .tab-scroll {
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
    scroll-padding-inline: 1rem;
    padding-inline: 1px;
  }
  .tab-scroll .filter-tab {
    flex-shrink: 0;
    scroll-snap-align: start;
    white-space: nowrap;
  }
  .tab-fade {
    position: absolute;
    inset-block: 0;
    width: 1.25rem;
    pointer-events: none;
  }
  .tab-fade-left {
    left: 0;
    background: linear-gradient(to right, var(--color-neutral-50), transparent);
  }
  .tab-fade-right {
    right: 0;
    background: linear-gradient(to left, var(--color-neutral-50), transparent);
  }

  .filter-tab {
    min-height: 3rem;
    font-weight: 600;
    padding-block: 0.5rem;
    color: var(--color-neutral-700);
    font-size: 0.875rem;
    text-decoration: underline 2px transparent;
    text-underline-offset: 0.4em;
  }
  .filter-tab[aria-pressed='true'] {
    font-weight: 600;
    color: var(--color-brand-900);
    text-decoration-color: var(--color-accent-500);
  }
  @media (hover: hover) {
    .filter-tab:not([aria-pressed='true']):hover {
      color: var(--color-brand-900);
      text-decoration-color: var(--color-neutral-300);
    }
  }
</style>
