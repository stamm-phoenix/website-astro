<script lang="ts">
  import { formatEuro } from '../../lib/format';
  import type { KostenstellenSummen } from '../../lib/types';

  interface Props {
    summen: KostenstellenSummen;
    /** Larger numbers, for the sum of all shown Kostenstellen. */
    gross?: boolean;
  }
  let { summen, gross = false }: Props = $props();

  // Spans only: the numbers also sit inside a <summary>, which takes no lists
  const spalten = $derived([
    { label: 'Einnahmen', cent: summen.incomeCent, ton: '' },
    { label: 'Ausgaben', cent: summen.expensesCent, ton: '' },
    {
      label: 'Saldo',
      cent: summen.balanceCent,
      ton: summen.balanceCent < 0 ? 'text-danger' : 'text-brand-900',
    },
  ]);
  const offen = $derived(
    [
      summen.openIncomeCent !== 0 && `${formatEuro(summen.openIncomeCent)} Einnahmen`,
      summen.openExpensesCent !== 0 && `${formatEuro(summen.openExpensesCent)} Ausgaben`,
    ].filter(Boolean)
  );
</script>

<span class="block">
  <span class="grid grid-cols-3 gap-2">
    {#each spalten as spalte (spalte.label)}
      <span class="block min-w-0">
        <span class="block text-xs font-semibold text-neutral-700">{spalte.label}</span>
        <span
          class="block font-semibold break-words tabular-nums {spalte.ton} {gross
            ? 'text-lg'
            : 'text-sm'}">{formatEuro(spalte.cent)}</span
        >
      </span>
    {/each}
  </span>
  {#if offen.length > 0}
    <span class="mt-1 block text-sm text-warning">Noch offen: {offen.join(' · ')}</span>
  {/if}
</span>
