<script lang="ts">
  import type { esserRechner } from '../../lib/essensplanungRechnung';
  import { zahlText } from '../../lib/essensplanungTeilnehmende';
  import { einplanungZeilen } from '../../lib/essensplanungDruck';
  import type { Einplanung, PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * The amounts of a planned dish at its meal, scaled to who eats there; shown where the planned
   * dish is unfolded in the list.
   */

  interface Props {
    kontext: PlanKontext;
    mahlzeit: PlanungMahlzeit;
    einplanung: Einplanung;
    /** Name of the dish, for the labels. */
    name: string;
    esser: ReturnType<typeof esserRechner>;
    /** Names of the intolerances; empty while not loaded. */
    unvertraeglichkeiten: Map<number, string>;
  }
  let { kontext, mahlzeit, einplanung, name, esser, unvertraeglichkeiten }: Props = $props();

  /** The portions and lines, the same as in the PDF of the plan. */
  const mengen = $derived(
    einplanungZeilen(kontext.ansicht, mahlzeit, einplanung, esser, unvertraeglichkeiten)
  );
  const portionen = $derived(mengen.portionen);
  const zeilen = $derived(mengen.zeilen);
</script>

{#snippet liste()}
  {#if !zeilen.length}
    <p class="text-sm text-neutral-700">Das Gericht hat noch keine Zutaten.</p>
  {:else}
    <ul class="text-sm" aria-label="Mengen für {name} bei {mahlzeit.kennung}">
      {#each zeilen as zeile, index (index)}
        <li class="[overflow-wrap:anywhere]">
          <span class="font-semibold tabular-nums">{zeile.menge}</span>
          {zeile.name}
          {#if zeile.fuer || zeile.hinweis}<span class="text-neutral-700"
              >· {[zeile.fuer, zeile.hinweis].filter(Boolean).join(' · ')}</span
            >{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<!-- The PDF of the plan prints the same lines (einplanungZeilen) -->
<div class="space-y-1">
  <p class="text-sm font-semibold">
    Mengen für {zahlText(portionen)} Portionen
    {#if mengen.personenFehlen}<span class="font-normal text-warning">· Personenzahl fehlt</span
      >{/if}
  </p>
  {@render liste()}
</div>
