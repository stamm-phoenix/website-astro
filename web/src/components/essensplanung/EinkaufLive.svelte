<script lang="ts">
  import type { EinkaufListe } from '../../lib/essensplanungEinkaeufe';
  import EinkaufLivePosten from './EinkaufLivePosten.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The live mode of a shopping trip: large rows by category, one tick each. The page asks for
   * changes every few seconds, so several people can shop the same list at once.
   */

  interface Props {
    kontext: PlanKontext;
    liste: EinkaufListe;
  }
  let { kontext, liste }: Props = $props();

  /** The thing whose amount is open. */
  let offen = $state<string | null>(null);
</script>

<div class="space-y-4">
  <p class="text-lg font-semibold" role="status" aria-live="polite">
    {liste.abgehakt} von {liste.anzahl} abgehakt
  </p>
  <p class="text-sm text-neutral-700">Häkchen werden sofort gespeichert.</p>
  {#each liste.kategorien as kategorie (kategorie.name)}
    <section class="space-y-1" aria-label="{liste.einkauf.name}: {kategorie.name}">
      <h5 class="font-semibold text-neutral-700">{kategorie.name}</h5>
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each kategorie.posten as posten (posten.key)}
          <EinkaufLivePosten
            {kontext}
            einkaufId={liste.einkauf.id}
            {posten}
            offen={offen === posten.key}
            onoeffnen={(auf) => (offen = auf ? posten.key : null)}
          />
        {/each}
      </ul>
    </section>
  {:else}
    <p class="text-neutral-700">Nichts zu kaufen.</p>
  {/each}
</div>
