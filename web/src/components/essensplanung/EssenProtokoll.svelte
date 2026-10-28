<script lang="ts">
  import { formatDateTime } from '../../lib/format';
  import { describeAudit } from '../../lib/essensplanungSteuerung';
  import type { EssenAuditEntry } from '../../lib/types';

  interface Props {
    entries: EssenAuditEntry[];
  }
  let { entries }: Props = $props();
</script>

<section aria-labelledby="essen-log-heading">
  <h2 id="essen-log-heading" class="font-serif text-xl font-bold text-brand-900">Protokoll</h2>
  <p class="mt-1 text-sm text-neutral-700">Die letzten 100 Änderungen in der Steuerung.</p>
  {#if entries.length}
    <ul class="mt-3 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
      {#each entries as entry (entry.id)}
        <li class="flex flex-wrap gap-x-4 gap-y-1 py-2">
          <span class="tabular-nums text-neutral-700">{formatDateTime(entry.at)}</span>
          <span class="text-neutral-700">{entry.actor}</span>
          <span class="text-neutral-900 [overflow-wrap:anywhere]">{describeAudit(entry)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="mt-2 text-sm text-neutral-700">Noch keine Änderungen.</p>
  {/if}
</section>
