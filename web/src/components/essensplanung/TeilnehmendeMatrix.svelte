<script lang="ts">
  import type { Snippet } from 'svelte';
  import QuerScroll from '../ui/QuerScroll.svelte';
  import {
    ERNAEHRUNG_TEXT,
    ERNAEHRUNGEN,
    jeErnaehrung,
    unvertraeglichkeitenNamen,
    zeitraumText,
  } from '../../lib/essensplanungTeilnehmende';
  import type { PlanungAnsicht, Teilnehmende } from '../../lib/types';

  /**
   * The participants as a matrix: a row each, by group, with its persons in the column of its
   * diet, then the intolerances, the stay and the note; the sums of the diets at the bottom.
   */

  interface Props {
    ansicht: PlanungAnsicht;
    unvertraeglichkeit: Map<number, string>;
    /** The buttons of a row, while it can be changed. */
    aktionen?: Snippet<[Teilnehmende]>;
  }
  let { ansicht, unvertraeglichkeit, aktionen }: Props = $props();

  const gruppen = $derived(
    ansicht.gruppen
      .map((gruppe) => ({
        gruppe,
        zeilen: ansicht.teilnehmende.filter((z) => z.gruppeId === gruppe.id),
      }))
      .filter(({ zeilen }) => zeilen.length)
  );
  const summe = $derived(jeErnaehrung(ansicht.teilnehmende));
  const mitHinweis = $derived(ansicht.teilnehmende.some((z) => z.hinweis));
  const KOPF =
    'border-b border-l border-neutral-300 bg-neutral-100 px-2 py-1 align-bottom text-xs font-semibold text-neutral-700';
  const ZELLE = 'border-b border-l border-neutral-200 px-2 py-0.5 align-top';
</script>

<QuerScroll
  label="Teilnehmende als Matrix"
  hinweis="Weitere Spalten siehst du, wenn du seitlich wischst oder scrollst."
>
  <table class="w-full border-separate border-spacing-0 text-left text-sm">
    <caption class="sr-only">Teilnehmende als Matrix</caption>
    <thead>
      <tr>
        <th
          scope="col"
          class="sticky left-0 z-10 w-24 min-w-24 border-r border-b border-neutral-300 bg-neutral-100 px-2 py-1 align-bottom text-xs font-semibold text-neutral-700 md:w-40"
        >
          Gruppe
        </th>
        {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
          <th scope="col" class="{KOPF} w-20 text-center">{ERNAEHRUNG_TEXT[ernaehrung]}</th>
        {/each}
        <th scope="col" class="{KOPF} min-w-36">Unverträglichkeiten</th>
        <th scope="col" class="{KOPF} min-w-44">Zeitraum</th>
        {#if mitHinweis}<th scope="col" class="{KOPF} min-w-36">Hinweis</th>{/if}
        {#if aktionen}<th scope="col" class={KOPF}><span class="sr-only">Ändern</span></th>{/if}
      </tr>
    </thead>
    {#each gruppen as { gruppe, zeilen }, g (gruppe.id)}
      {@const streifen = g % 2 === 1 ? 'bg-neutral-50' : 'bg-surface'}
      <tbody>
        {#each zeilen as zeile, z (zeile.id)}
          {@const ohne = unvertraeglichkeitenNamen(zeile, unvertraeglichkeit)}
          {@const zeitraum = zeitraumText(ansicht, zeile)}
          <tr class={streifen} data-teilnehmende={zeile.id}>
            {#if z === 0}
              <th
                scope="rowgroup"
                rowspan={zeilen.length}
                class="sticky left-0 z-10 border-r border-b border-neutral-300 px-2 py-0.5 align-top font-semibold [overflow-wrap:anywhere] text-brand-900 {streifen}"
              >
                {gruppe.name}
              </th>
            {/if}
            {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
              <td class="{ZELLE} text-center font-semibold tabular-nums">
                {#if zeile.ernaehrung === ernaehrung}<span data-anzahl={ernaehrung}
                    >{zeile.anzahl}</span
                  >{/if}
              </td>
            {/each}
            <td class={ZELLE}>
              {#if ohne.length}{ohne.join(', ')}{:else}<span class="text-neutral-700">keine</span
                >{/if}
            </td>
            <td class={ZELLE}>
              {#if zeitraum}{zeitraum}{:else}<span class="text-neutral-700">ganze Zeit</span>{/if}
            </td>
            {#if mitHinweis}<td class="{ZELLE} [overflow-wrap:anywhere]">{zeile.hinweis}</td>{/if}
            {#if aktionen}<td class="{ZELLE} py-0.5">{@render aktionen(zeile)}</td>{/if}
          </tr>
        {/each}
      </tbody>
    {/each}
    <tfoot>
      <tr class="bg-neutral-100">
        <th
          scope="row"
          class="sticky left-0 z-10 border-r border-neutral-300 bg-neutral-100 px-2 py-1 font-semibold text-brand-900"
        >
          Insgesamt
        </th>
        {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
          <td
            class="border-l border-neutral-300 px-2 py-1 text-center font-bold tabular-nums"
            data-summe={ernaehrung}>{summe[ernaehrung]}</td
          >
        {/each}
        <td
          class="border-l border-neutral-300"
          colspan={2 + (mitHinweis ? 1 : 0) + (aktionen ? 1 : 0)}
        ></td>
      </tr>
    </tfoot>
  </table>
</QuerScroll>
