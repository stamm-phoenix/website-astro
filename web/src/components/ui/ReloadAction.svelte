<script lang="ts">
  import { formatClock } from '../../lib/format';
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
  const time = $derived(loadedAt === null ? null : formatClock(loadedAt));
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
    min-height: 2.75rem;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
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
