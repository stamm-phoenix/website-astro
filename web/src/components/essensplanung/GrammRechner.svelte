<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import type { EssenKatalog } from '../../lib/types';

  /** Converts TL, EL or pieces of an ingredient measured by weight into grams, from the list. */

  interface Props {
    /** The central ingredient with its grams per TL, EL and piece. */
    zentral: EssenKatalog['zutaten'][number];
    /** The amount the line has in TL, EL or pieces, to start with. */
    vorgabe?: { anzahl: string; mass: 'tl' | 'el' | 'stueck' };
    /** Takes the result over as the amount in g. */
    onuebernehmen: (gramm: number) => void;
  }
  let { zentral, vorgabe, onuebernehmen }: Props = $props();

  const umrechnung = $derived(
    [
      { mass: 'tl', label: 'TL', gramm: zentral.grammProTl },
      { mass: 'el', label: 'EL', gramm: zentral.grammProEl },
      { mass: 'stueck', label: 'Stück', gramm: zentral.grammProStueck },
    ].filter(
      (entry): entry is { mass: string; label: string; gramm: number } => entry.gramm !== null
    )
  );
  let anzahl = $state(untrack(() => vorgabe?.anzahl ?? '1'));
  let mass = $state<string>(untrack(() => vorgabe?.mass ?? ''));
  // The line typed in TL, EL or pieces: the conversion follows it
  $effect(() => {
    const von = vorgabe;
    if (!von) return;
    untrack(() => {
      anzahl = von.anzahl;
      mass = von.mass;
    });
  });
  const gramm = $derived.by(() => {
    const zahl = leseMenge(anzahl);
    const eintrag = umrechnung.find((entry) => entry.mass === mass);
    if (!eintrag || zahl === null || Number.isNaN(zahl)) return null;
    // Whole grams, a tenth below 10 g (spices)
    const roh = zahl * eintrag.gramm;
    return roh < 10 ? Math.round(roh * 10) / 10 : Math.round(roh);
  });
  // The measure shown is the one calculated with: the first one when the chosen is not offered
  $effect(() => {
    if (umrechnung.length && !umrechnung.some((entry) => entry.mass === mass))
      mass = umrechnung[0].mass;
  });
</script>

{#if umrechnung.length}
  <fieldset class="space-y-2 rounded-md border border-neutral-200 p-3">
    <legend class="flex items-center gap-1 px-1 text-sm font-semibold text-neutral-900">
      In Gramm umrechnen
      <InfoHint
        label="In Gramm umrechnen"
        text="Anhaltswerte aus der Umrechnungstabelle der Zutatenliste, gestrichen gemessen. Übernehmen trägt das Ergebnis als Menge in g ein."
      />
    </legend>
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="umrechnen-anzahl">Anzahl zum Umrechnen</label>
      <input
        id="umrechnen-anzahl"
        class="form-input w-20"
        inputmode="decimal"
        autocomplete="off"
        bind:value={anzahl}
      />
      <label class="sr-only" for="umrechnen-mass">Maß zum Umrechnen</label>
      <select id="umrechnen-mass" class="form-input w-auto" bind:value={mass}>
        {#each umrechnung as eintrag (eintrag.mass)}
          <option value={eintrag.mass}>{eintrag.label}</option>
        {/each}
      </select>
      <span class="tabular-nums" aria-live="polite"
        >{gramm === null ? '' : `≈ ${mengeFeld(gramm)} g`}</span
      >
      <ActionButton
        type="button"
        disabled={gramm === null || gramm <= 0}
        onclick={() => gramm !== null && gramm > 0 && onuebernehmen(gramm)}>Übernehmen</ActionButton
      >
    </div>
  </fieldset>
{/if}
