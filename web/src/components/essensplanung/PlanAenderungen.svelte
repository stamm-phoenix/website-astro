<script lang="ts">
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { formatDateTime } from '../../lib/format';
  import { aenderungText } from '../../lib/essensplanung';
  import type { PlanungAenderung } from '../../lib/types';

  interface Props {
    aenderungen: PlanungAenderung[];
  }
  let { aenderungen }: Props = $props();
</script>

<details class="print:hidden">
  <summary
    class="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-brand-900 [&::-webkit-details-marker]:hidden"
  >
    Letzte Änderungen
    <AufklappPfeil />
  </summary>
  {#if aenderungen.length}
    <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
      {#each aenderungen as aenderung (aenderung.seq)}
        <li class="flex flex-wrap gap-x-4 gap-y-1 py-2">
          <span class="tabular-nums text-neutral-700">{formatDateTime(aenderung.at)}</span>
          <span class="text-neutral-900 [overflow-wrap:anywhere]">{aenderungText(aenderung)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-sm text-neutral-700">Noch keine Änderungen.</p>
  {/if}
</details>
