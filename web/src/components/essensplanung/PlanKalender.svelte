<script lang="ts">
  import QuerScroll from '../ui/QuerScroll.svelte';
  import { datumKurz } from '../../lib/essensplanung';
  import { einplanungKennung, faktorText } from '../../lib/essensplanungEinplanung';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { esserRechner } from '../../lib/essensplanungRechnung';
  import { zahlText } from '../../lib/essensplanungTeilnehmende';
  import type { PlanungMahlzeit } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * The plan as a calendar: the days next to each other, the meals of a day below each other in
   * their order, the planned dishes as cards like appointments. A card opens the dialog of the
   * planned dish; days and meals are changed and dishes ticked off in the list.
   */

  interface Props {
    kontext: PlanKontext;
    bearbeiten: boolean;
    /** Opens the dialog of planned dishes. */
    oneinplanen: (auftrag: Auftrag) => void;
    /** Opens ticking off the planned dish (or what a cooked one used), which is in the list. */
    onabhaken: (einplanungId: number) => void;
  }
  let { kontext, bearbeiten, oneinplanen, onabhaken }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  const ALLE = { fuerAlles: true, fuerVegetarisch: true, fuerVegan: true, ohne: [], nur: [] };
  const esser = $derived(esserRechner(ansicht));
  const gerichte = $derived(new Map(ansicht.gerichte.map((g) => [g.id, g.name])));
  /** As many rows as the day with the most meals; shorter days leave their cells empty. */
  const zeilen = $derived([
    ...Array(Math.max(0, ...ansicht.tage.map((tag) => tag.mahlzeiten.length))).keys(),
  ]);

  /** The time and the name, „12:30 Mittagessen“. */
  function mahlzeitTitel(mahlzeit: PlanungMahlzeit): string {
    return [mahlzeit.uhrzeit, mahlzeit.name].filter(Boolean).join(' ');
  }
</script>

<QuerScroll
  label="Plan als Kalender"
  hinweis="Weitere Tage siehst du, wenn du seitlich wischst oder scrollst."
>
  <table class="border-separate border-spacing-2 text-left text-sm">
    <caption class="sr-only">Plan als Kalender</caption>
    <thead>
      <tr>
        {#each ansicht.tage as tag (tag.id)}
          <th scope="col" class="w-44 min-w-44 align-bottom font-semibold text-brand-900">
            Tag {tag.nummer}
            <span class="block font-normal text-neutral-700">{datumKurz(tag.datum)}</span>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each zeilen as zeile (zeile)}
        <tr>
          {#each ansicht.tage as tag (tag.id)}
            {@const mahlzeit = tag.mahlzeiten[zeile]}
            <td class="w-44 min-w-44 max-w-44 align-top">
              {#if mahlzeit}
                <div
                  class="h-full space-y-1.5 rounded-lg border border-neutral-200 bg-surface p-2"
                  data-kalender={mahlzeit.kennung}
                >
                  <p class="[overflow-wrap:anywhere]">
                    <span class="font-mono font-semibold text-brand-900">{mahlzeit.kennung}</span>
                    {mahlzeitTitel(mahlzeit)}
                  </p>
                  <ul class="space-y-1.5" aria-label="Gerichte bei {mahlzeit.kennung}">
                    {#each mahlzeit.einplanungen as einplanung (einplanung.id)}
                      {@const name = gerichte.get(einplanung.gerichtId) ?? 'Gericht'}
                      {@const kennung = einplanungKennung(mahlzeit, einplanung.id)}
                      {@const portionen = esser(mahlzeit, ALLE) * einplanung.faktor}
                      <li>
                        {#snippet karte()}
                          <span
                            class="block font-semibold text-neutral-900 [overflow-wrap:anywhere]"
                            ><span class="font-mono text-xs text-brand-900">{kennung}</span>
                            {name}</span
                          >
                          <span class="block text-xs text-neutral-700 tabular-nums">
                            {zahlText(portionen)} Portionen{faktorText(einplanung.faktor)
                              ? ` · ${faktorText(einplanung.faktor)}`
                              : ''}{einplanung.zustaendig ? ` · ${einplanung.zustaendig}` : ''}
                          </span>
                          {#if einplanung.status !== 'offen'}
                            <span
                              class="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold {einplanung.status ===
                              'gekocht'
                                ? 'bg-success-soft text-success'
                                : 'bg-neutral-100 text-neutral-700'}">{einplanung.status}</span
                            >
                          {/if}
                        {/snippet}
                        {#if bearbeiten}
                          <button
                            type="button"
                            class="block min-h-11 w-full cursor-pointer rounded-md border-l-4 border-brand-800 bg-brand-50 px-2 py-1.5 text-left hover:bg-brand-100"
                            aria-label="{kennung} {name} ändern"
                            onclick={() =>
                              oneinplanen({
                                modus: 'aendern',
                                mahlzeitId: mahlzeit.id,
                                einplanungId: einplanung.id,
                              })}>{@render karte()}</button
                          >
                          <button
                            type="button"
                            class="min-h-11 text-sm font-semibold text-link underline"
                            aria-label="{kennung} {name} abhaken"
                            onclick={() => onabhaken(einplanung.id)}
                            >{einplanung.status === 'gekocht'
                              ? 'Verbrauch ändern'
                              : 'Abhaken'}</button
                          >
                        {:else}
                          <div
                            class="rounded-md border-l-4 border-brand-800 bg-brand-50 px-2 py-1.5"
                          >
                            {@render karte()}
                          </div>
                          {#if einplanung.status === 'gekocht'}
                            <button
                              type="button"
                              class="min-h-11 text-sm font-semibold text-link underline"
                              aria-label="Verbrauch von {kennung} {name} ansehen"
                              onclick={() => onabhaken(einplanung.id)}>Verbrauch ansehen</button
                            >
                          {/if}
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  {#if bearbeiten && gerichte.size}
                    <button
                      type="button"
                      class="min-h-11 text-sm font-semibold text-link underline"
                      aria-label="Gericht einplanen bei {mahlzeit.kennung}"
                      onclick={() =>
                        oneinplanen({ modus: 'neu', mahlzeitId: mahlzeit.id, einplanungId: null })}
                      >+ Gericht</button
                    >
                  {/if}
                </div>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</QuerScroll>
