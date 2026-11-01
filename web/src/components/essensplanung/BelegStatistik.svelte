<script lang="ts">
  import { euro, type BelegStatistik } from '../../lib/essensplanungBelege';

  /** Who paid how much, and what each still gets back; receipts paid back count in the totals. */

  interface Props {
    statistik: BelegStatistik;
  }
  let { statistik }: Props = $props();
</script>

<section aria-labelledby="belege-statistik" class="space-y-1">
  <h3 id="belege-statistik" class="text-sm font-semibold text-brand-900">Wer hat was bezahlt</h3>
  <table class="w-full border-collapse text-sm" data-testid="belege-statistik">
    <thead>
      <tr class="border-b-2 border-neutral-300 text-left text-xs text-neutral-700">
        <th scope="col" class="px-1.5 py-1 font-semibold">Bezahlt von</th>
        <th scope="col" class="px-1.5 py-1 text-right font-semibold">Belege</th>
        <th scope="col" class="px-1.5 py-1 text-right font-semibold">Bezahlt</th>
        <th scope="col" class="px-1.5 py-1 text-right font-semibold">Noch zu erstatten</th>
      </tr>
    </thead>
    <tbody>
      {#each statistik.personen as person (person.key)}
        <tr class="border-b border-neutral-200">
          <th scope="row" class="px-1.5 py-1 text-left font-normal [overflow-wrap:anywhere]"
            >{person.name}</th
          >
          <td class="px-1.5 py-1 text-right tabular-nums">{person.anzahl}</td>
          <td class="px-1.5 py-1 text-right whitespace-nowrap tabular-nums"
            >{euro(person.gesamtCent)}</td
          >
          <td
            class="px-1.5 py-1 text-right whitespace-nowrap tabular-nums {person.offenCent
              ? 'font-semibold text-brand-900'
              : 'text-neutral-700'}">{euro(person.offenCent)}</td
          >
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr class="border-t-2 border-neutral-300 font-semibold">
        <th scope="row" class="px-1.5 py-1 text-left">Summe</th>
        <td class="px-1.5 py-1 text-right tabular-nums">{statistik.anzahl}</td>
        <td class="px-1.5 py-1 text-right whitespace-nowrap tabular-nums"
          >{euro(statistik.gesamtCent)}</td
        >
        <td class="px-1.5 py-1 text-right whitespace-nowrap tabular-nums"
          >{euro(statistik.offenCent)}</td
        >
      </tr>
    </tfoot>
  </table>
  <p class="text-xs text-neutral-700">Davon erstattet: {euro(statistik.erstattetCent)}</p>
</section>
