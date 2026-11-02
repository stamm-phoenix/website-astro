<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage } from '../../lib/api';
  import type { EssenKatalog } from '../../lib/types';
  import PostenDialog from './PostenDialog.svelte';
  import PostenListe from './PostenListe.svelte';
  import { lagerZeilen } from '../../lib/essensplanungLager';
  import InfoHint from '../ui/InfoHint.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The stock during the Aktion: what was there before, what the cooked dishes used and what is
   * left, which the shopping list takes off; next to it the stock before the Aktion to change.
   */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const zeilen = $derived(lagerZeilen(ansicht));

  /** The central lists, for the choice of ingredients. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  /** The `katalogStand` the lists were loaded for. */
  let geladen: string | null = null;
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    geladen = ansicht.katalogStand;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      // Not loaded: the next view or the button tries again
      geladen = null;
      katalogFehler = errorMessage(error, 'Die Liste der Zutaten konnte nicht geladen werden.');
    }
  }
  $effect(() => {
    if (sichtbar && ansicht.katalogStand !== geladen) untrack(() => void katalogLaden());
  });

  /** The entry of the stock in the dialog; null adds one, undefined: closed. */
  let postenId = $state<number | null | undefined>(undefined);
</script>

<div class="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
  <section aria-labelledby="lager-heading" class="surface space-y-3 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <h3 id="lager-heading" class="font-serif text-lg font-bold text-brand-900">Lager</h3>
        <InfoHint label="Lager" text="Was übrig ist, zieht die Einkaufsliste ab." />
      </div>
      <PdfKnopf
        {kontext}
        label="Lager als PDF"
        erstellen={async () => {
          const { downloadLagerPdf } = await import('../../lib/essensplanungPdf');
          await downloadLagerPdf(ansicht, zeilen);
        }}
      />
    </div>
    {#if zeilen.length}
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm" aria-label="Lager">
          <thead>
            <tr class="border-b border-neutral-300">
              <th scope="col" class="py-1 pr-3">Zutat</th>
              <th scope="col" class="py-1 pr-3 text-right">Vorher</th>
              <th scope="col" class="py-1 pr-3 text-right">Erhalten</th>
              <th scope="col" class="py-1 pr-3 text-right">Verbraucht</th>
              <th scope="col" class="py-1 text-right">Übrig</th>
            </tr>
          </thead>
          <tbody>
            {#each zeilen as zeile, index (index)}
              <tr class="border-b border-neutral-200">
                <th scope="row" class="py-1 pr-3 font-semibold [overflow-wrap:anywhere]"
                  >{zeile.name}{#if zeile.ersatz}<span class="block font-normal text-neutral-700"
                      >{zeile.ersatz}</span
                    >{/if}</th
                >
                <td class="py-1 pr-3 text-right tabular-nums">{zeile.anfang}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{zeile.erhalten}</td>
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
  <PostenListe
    {kontext}
    art="bestand"
    titel="Bestand"
    eintraege={ansicht.bestand}
    leer="Noch kein Bestand."
    onbearbeiten={(id) => (postenId = id)}
  />
</div>

<PostenDialog
  {kontext}
  {katalog}
  {katalogFehler}
  onkatalog={() => void katalogLaden()}
  art="bestand"
  {postenId}
  onclose={() => (postenId = undefined)}
/>
