<script lang="ts">
  import { formatIsoDate } from '../../lib/belege';
  import { formatEuro } from '../../lib/format';
  import type { TransferredBeleg } from '../../lib/types';
  interface Props {
    items: TransferredBeleg[];
    onopen: (beleg: TransferredBeleg) => void;
  }
  let { items, onopen }: Props = $props();
</script>

<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {#each items as beleg (beleg.id)}
    <li class="min-w-0">
      <button
        type="button"
        class="card flex w-full flex-col items-stretch text-left hover:border-[var(--color-brand-300)]"
        onclick={() => onopen(beleg)}
      >
        <span class="flex flex-wrap items-start justify-between gap-x-2">
          <span class="min-w-0 break-words font-semibold text-brand-900">{beleg.shop}</span>
          <span class="shrink-0 font-semibold text-brand-900">{formatEuro(beleg.amountCent)}</span>
        </span>
        <span class="block truncate text-sm text-neutral-700">
          {formatIsoDate(beleg.date)} · {beleg.aktion}
        </span>
        <span class="block truncate text-xs text-neutral-700">
          {beleg.costUnitName} · {beleg.categoryName}
        </span>
        <span class="mt-1.5 flex flex-wrap gap-1">
          <span class="tag">CampFlow {beleg.number}</span>
          {#if beleg.payout}
            <span class="tag">Auszahlung</span>
          {/if}
        </span>
      </button>
    </li>
  {/each}
</ul>
