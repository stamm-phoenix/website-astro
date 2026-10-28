<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import ActionButton from './ActionButton.svelte';
  import MessageText from './MessageText.svelte';
  import { problemMeldenHref } from '../../lib/problemMelden';

  interface Props {
    data: T | null;
    loading: boolean;
    /** The load error; `true` when the store only knows that loading failed. */
    error: string | boolean | null;
    /** Read by screen readers while loading, e.g. "Belege werden geladen …". */
    loadingText?: string;
    onretry?: () => void;
    /** Placeholder while nothing is loaded yet; three bars by default. */
    skeleton?: Snippet;
    /** Shown instead of `children` when `isEmpty` says there is nothing to list. */
    empty?: Snippet;
    isEmpty?: (data: T) => boolean;
    children: Snippet<[T]>;
  }
  let {
    data,
    loading,
    error,
    loadingText = 'Wird geladen …',
    onretry,
    skeleton,
    empty,
    isEmpty,
    children,
  }: Props = $props();

  const message = $derived(
    typeof error === 'string' && error ? error : 'Die Daten konnten nicht geladen werden.'
  );
</script>

{#snippet retry()}
  <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
    {#if onretry}
      <ActionButton variant="secondary" type="button" disabled={loading} onclick={onretry}
        >Erneut versuchen</ActionButton
      >
    {/if}
    <a class="text-link inline-flex min-h-11 items-center text-sm" href={problemMeldenHref()}
      >Problem melden</a
    >
  </div>
{/snippet}

{#if data === null}
  {#if loading || !error}
    <div role="status" aria-live="polite">
      <span class="sr-only">{loadingText}</span>
      {#if skeleton}
        {@render skeleton()}
      {:else}
        <div class="space-y-3">
          {#each [1, 2, 3] as n (n)}<div
              class="skeleton-element h-16 rounded-[var(--radius-lg)]"
            ></div>{/each}
        </div>
      {/if}
    </div>
  {:else}
    <div role="alert" class="border-l-2 border-danger py-1 pl-4">
      <p class="text-sm text-neutral-700"><MessageText text={message} /></p>
      {@render retry()}
    </div>
  {/if}
{:else}
  {#if error}
    <div role="alert" class="mb-4 border-l-2 border-danger py-1 pl-4">
      <p class="text-sm text-neutral-700">
        <MessageText text={message} /> Angezeigt wird der zuletzt geladene Stand.
      </p>
      {@render retry()}
    </div>
  {/if}
  {#if empty && isEmpty?.(data)}
    {@render empty()}
  {:else}
    {@render children(data)}
  {/if}
{/if}
