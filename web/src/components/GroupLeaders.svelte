<script lang="ts">
  import { onMount } from 'svelte';
  import { leitendeStore, fetchLeitende, getLeadersForGroup } from '../lib/leitendeStore.svelte';

  interface Props {
    groupKey: string;
  }

  let { groupKey }: Props = $props();

  let leaders = $derived(getLeadersForGroup(groupKey));
  let leadersText = $derived(leaders.join(', '));

  onMount(() => {
    fetchLeitende();
  });
</script>

{#if leitendeStore.loading}
  <span class="skeleton-element skeleton-inline" role="status"
    ><span class="sr-only">Wird geladen</span></span
  >
{:else if leitendeStore.error}
  <span class="status-text">Leitende konnten nicht geladen werden</span>
{:else if leaders.length > 0}
  <span class="group-leaders">{leadersText}</span>
{:else}
  <span class="status-text">Keine Leitenden</span>
{/if}

<style>
  .skeleton-inline {
    display: inline-block;
    width: 10rem;
    height: 1em;
    vertical-align: middle;
    /* Colour and animation come from the shared .skeleton-element */
    border-radius: var(--radius-sm);
  }

  .status-text {
    color: var(--color-neutral-700);
    font-style: italic;
  }
</style>
