<script lang="ts">
  import type { EinkaufListe, EinkaufListenPosten } from '../../lib/essensplanungEinkaeufe';
  import type { PostenHerkunft } from '../../lib/essensplanungHerkunft';
  import EinkaufLivePosten from './EinkaufLivePosten.svelte';
  import { untrack } from 'svelte';
  import { liveOffen, offeneZeile } from './einkaufLive';
  import type { PlanKontext } from './planKontext';

  /**
   * The live mode of a shopping trip: one row with a box per thing, by category. The page asks
   * for changes every few seconds, so several people can shop the same list at once.
   */

  interface Props {
    kontext: PlanKontext;
    liste: EinkaufListe;
    /** Read-only for a while (maintenance). */
    gesperrt?: boolean;
    /** The dishes a thing is for. */
    herkunft: (posten: EinkaufListenPosten) => PostenHerkunft | undefined;
  }
  let { kontext, liste, gesperrt = false, herkunft }: Props = $props();

  $effect(() => liveOffen(liste.einkauf.id));

  /** The thing whose amount is open on a phone; kept when the trip shows its list meanwhile. */
  let offen = $state<string | null>(untrack(() => offeneZeile.get(liste.einkauf.id) ?? null));
  $effect(() => {
    const id = liste.einkauf.id;
    if (offen === null) offeneZeile.delete(id);
    else offeneZeile.set(id, offen);
  });
</script>

<div class="max-w-5xl space-y-3" data-live-liste>
  <p class="text-xs text-neutral-700">Häkchen werden sofort gespeichert.</p>
  {#each liste.kategorien as kategorie (kategorie.name)}
    <section aria-label="{liste.einkauf.name}: {kategorie.name}">
      <h4
        class="border-b border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-bold tracking-wide text-neutral-700 uppercase"
      >
        {kategorie.name}
      </h4>
      <ul class="divide-y divide-neutral-200">
        {#each kategorie.posten as posten (posten.key)}
          <EinkaufLivePosten
            {kontext}
            einkaufId={liste.einkauf.id}
            {posten}
            {gesperrt}
            herkunft={herkunft(posten)}
            offen={offen === posten.key}
            onoeffnen={(auf) => (offen = auf ? posten.key : offen === posten.key ? null : offen)}
          />
        {/each}
      </ul>
    </section>
  {:else}
    <p class="text-neutral-700">Nichts zu kaufen.</p>
  {/each}
</div>
