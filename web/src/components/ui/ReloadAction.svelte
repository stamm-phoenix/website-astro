<script lang="ts">
  import { formatClock, formatDateTime, isToday } from '../../lib/format';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    children?: Snippet;
    loadedAt?: number | null;
  }
  let {
    children,
    loadedAt = null,
    class: className = '',
    type = 'button',
    ...attributes
  }: Props = $props();
  /** Only the clock for today's loads; an older stand, e.g. an export, keeps its date. */
  const time = $derived(
    loadedAt === null
      ? null
      : isToday(loadedAt)
        ? formatClock(loadedAt)
        : formatDateTime(new Date(loadedAt))
  );
</script>

<span class="inline-flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
  {#if time}<span>Stand: {time} Uhr</span>{/if}
  <button {type} class="reload-action {className}" {...attributes}
    >{#if children}{@render children()}{:else}Neu laden{/if}</button
  >
</span>

<style>
  .reload-action {
    display: inline-flex;
    min-height: calc(var(--spacing) * 11);
    min-width: calc(var(--spacing) * 11);
    align-items: center;
    justify-content: center;
    gap: calc(var(--spacing) * 1.5);
    padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2);
    border: 0;
    background: transparent;
    color: var(--color-link);
    font-size: 0.875rem;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .reload-action:disabled {
    cursor: wait;
    color: var(--color-neutral-700);
  }
  .reload-action:not(:disabled):hover {
    text-decoration-thickness: 2px;
  }
</style>
