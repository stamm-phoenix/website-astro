<script lang="ts">
  import { onMount } from "svelte";
  import {
    leitendeStore,
    fetchLeitende,
    getLeadersForGroup,
  } from "../lib/leitendeStore.svelte";

  interface Props {
    groupKey: string;
  }

  let { groupKey }: Props = $props();

  let leaders = $derived(getLeadersForGroup(groupKey));
  let leadersText = $derived(leaders.join(", "));

  onMount(() => {
    fetchLeitende();
  });
</script>

{#if leitendeStore.loading}
  <span class="skeleton" aria-label="Wird geladen"></span>
{:else if leitendeStore.error}
  <span class="status-text">Leitende konnten nicht geladen werden</span>
{:else if leaders.length > 0}
  <span class="group-leaders">{leadersText}</span>
{:else}
  <span class="status-text">Keine Leitenden</span>
{/if}

<style>
  .skeleton {
    display: inline-block;
    width: 10rem;
    height: 1em;
    vertical-align: middle;
    background: linear-gradient(
      90deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 50%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
    border-radius: 0.25rem;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .status-text {
    color: var(--color-neutral-500);
    font-style: italic;
  }
</style>
