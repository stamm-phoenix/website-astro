<script lang="ts">
  import { confirmAction } from '../../lib/confirm';
  import { zeileBody } from '../../lib/essensplanungGerichte';
  import type { EssenKatalog, Gericht, GerichtZutat, PlanungZutat } from '../../lib/types';
  import NeueZutatZeile, { type NeueZeile } from './NeueZutatZeile.svelte';
  import ZutatZeileInline from './ZutatZeileInline.svelte';
  import GerichtZeileDialog, { type ZeilenVorgabe } from './GerichtZeileDialog.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The ingredients of a dish: its lines as rows to type in, the new row below them and the
   * dialog for the rest of a line.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    bearbeiten: boolean;
    /** The ingredients of the Planung by id. */
    zutaten: Map<number, PlanungZutat>;
    /** Names of the intolerances; empty while not loaded. */
    unvertraeglichkeiten: Map<number, string>;
    /** What is typed in the new row; the card keeps it. */
    neueZeile: NeueZeile;
  }
  let {
    kontext,
    katalog,
    gericht,
    bearbeiten,
    zutaten,
    unvertraeglichkeiten,
    neueZeile = $bindable(),
  }: Props = $props();

  async function verschiebe(zeile: GerichtZutat, position: number): Promise<void> {
    await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/gericht-zutaten/${zeile.id}`, { ...zeileBody(zeile), position })
    );
  }

  /** Asks and removes a line; whether it was removed. */
  async function zeileLoeschen(zeile: GerichtZutat): Promise<boolean> {
    const name = zutaten.get(zeile.planungZutatId)?.name ?? 'Zutat';
    if (
      !(await confirmAction({
        title: `${name} entfernen?`,
        message: `Die Zeile wird aus „${gericht.name}“ entfernt.`,
        confirmLabel: 'Entfernen',
      }))
    )
      return false;
    return kontext.aendern(
      () => kontext.api.senden('DELETE', `/gericht-zutaten/${zeile.id}`, undefined, zeile.etag),
      `${name} entfernt.`
    );
  }

  let dialog = $state<{
    zeile: GerichtZutat | null;
    vorgabe: ZeilenVorgabe | null;
  } | null>(null);
</script>

<section aria-labelledby="gericht-{gericht.id}-zutaten" class="space-y-2">
  <h4 id="gericht-{gericht.id}-zutaten" class="font-semibold text-brand-900">Zutaten</h4>
  {#if gericht.zutaten.length}
    <ol class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each gericht.zutaten as zeile, index (zeile.id)}
        <ZutatZeileInline
          {kontext}
          {zeile}
          zutat={zutaten.get(zeile.planungZutatId)}
          {bearbeiten}
          erste={index === 0}
          letzte={index === gericht.zutaten.length - 1}
          namen={unvertraeglichkeiten}
          katalogDa={katalog !== null}
          position={index + 1}
          onaendern={() => (dialog = { zeile, vorgabe: null })}
          onverschiebe={(position) => void verschiebe(zeile, position)}
          onloeschen={() => zeileLoeschen(zeile)}
        />
      {/each}
    </ol>
  {:else}
    <p class="text-sm text-neutral-700">Noch keine Zutaten.</p>
  {/if}
  {#if bearbeiten && katalog}
    <NeueZutatZeile
      {kontext}
      {katalog}
      {gericht}
      bind:eingabe={neueZeile}
      onmehr={(vorgabe) => (dialog = { zeile: null, vorgabe })}
    />
  {/if}
</section>

{#if katalog && dialog}
  <GerichtZeileDialog
    {kontext}
    {katalog}
    {gericht}
    zeile={dialog.zeile}
    vorgabe={dialog.vorgabe}
    open={dialog !== null}
    onclose={() => (dialog = null)}
  />
{/if}
