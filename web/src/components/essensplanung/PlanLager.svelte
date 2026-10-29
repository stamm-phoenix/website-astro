<script lang="ts">
  import { lagerZeilen } from '../../lib/essensplanungLager';
  import PdfKnopf from './PdfKnopf.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The stock during the Aktion: what was there before, what the cooked dishes used and what is
   * left, which the shopping list takes off.
   */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const zeilen = $derived(lagerZeilen(ansicht));
</script>

<section aria-labelledby="lager-heading" class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="lager-heading" class="font-serif text-lg font-bold text-brand-900">Lager</h3>
    <PdfKnopf
      {kontext}
      label="Lager als PDF"
      erstellen={async () => {
        const { downloadLagerPdf } = await import('../../lib/essensplanungPdf');
        await downloadLagerPdf(ansicht, zeilen);
      }}
    />
  </div>
  <p class="text-sm text-neutral-700">
    Bestand vor der Aktion minus das, was abgehakte Gerichte verbraucht haben. Was übrig ist, zieht
    die Einkaufsliste ab.
  </p>
  {#if zeilen.length}
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-neutral-300">
            <th scope="col" class="py-1 pr-3">Zutat</th>
            <th scope="col" class="py-1 pr-3 text-right">Vorher</th>
            <th scope="col" class="py-1 pr-3 text-right">Verbraucht</th>
            <th scope="col" class="py-1 text-right">Übrig</th>
          </tr>
        </thead>
        <tbody>
          {#each zeilen as zeile (zeile.planungZutatId + zeile.anfang + zeile.verbraucht)}
            <tr class="border-b border-neutral-200">
              <th scope="row" class="py-1 pr-3 font-semibold [overflow-wrap:anywhere]"
                >{zeile.name}</th
              >
              <td class="py-1 pr-3 text-right tabular-nums">{zeile.anfang}</td>
              <td class="py-1 pr-3 text-right tabular-nums">{zeile.verbraucht}</td>
              <td
                class="py-1 text-right font-semibold tabular-nums {zeile.leer
                  ? 'text-neutral-700'
                  : ''}">{zeile.jetzt}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-neutral-700">Noch nichts im Lager.</p>
  {/if}
</section>
