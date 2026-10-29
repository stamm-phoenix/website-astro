<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { zeileBody } from '../../lib/essensplanungGerichte';
  import {
    aenderungText,
    kiFehlerText,
    type KiHinweis,
    type KiPruefung,
  } from '../../lib/essensplanungKi';
  import type { EssenKatalog, Gericht, PlanungZutat } from '../../lib/types';
  import RezeptImportDialog from './RezeptImportDialog.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The AI at a dish, for those who edit: „Gericht prüfen“ lists hints with a proposal (a change
   * of a line can be taken over with one click), „Rezept einfügen“ reads the lines of a pasted
   * recipe for confirmation. Answers are marked as AI and unchecked.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    zutaten: ReadonlyMap<number, PlanungZutat>;
  }
  let { kontext, katalog, gericht, zutaten }: Props = $props();

  let pruefung = $state<KiPruefung | null>(null);
  let prueft = $state(false);
  let fehler = $state<string | null>(null);
  /** Indexes of the hints whose change was taken over. */
  let uebernommen = $state<number[]>([]);
  let rezeptOffen = $state(false);

  async function pruefen(): Promise<void> {
    prueft = true;
    fehler = null;
    pruefung = null;
    try {
      pruefung = await kontext.api.senden<KiPruefung>('POST', `/gerichte/${gericht.id}/ki/pruefen`);
      uebernommen = [];
    } catch (error: unknown) {
      fehler = kiFehlerText(error);
    } finally {
      prueft = false;
    }
  }

  function zeileVon(hinweis: KiHinweis) {
    return hinweis.zeile
      ? gericht.zutaten.find((zeile) => zeile.id === hinweis.zeile!.id)
      : undefined;
  }

  function nameVon(hinweis: KiHinweis): string | undefined {
    const zeile = zeileVon(hinweis);
    return zeile ? zutaten.get(zeile.planungZutatId)?.name : undefined;
  }

  /** Saves the proposed change with the version that was checked: a change since is a conflict. */
  async function uebernehmen(index: number, hinweis: KiHinweis): Promise<void> {
    const zeile = zeileVon(hinweis);
    if (!zeile || !hinweis.zeile || !hinweis.aenderung) {
      fehler = 'Diese Zutat gibt es nicht mehr. Lass das Gericht noch einmal prüfen.';
      return;
    }
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PATCH', `/gericht-zutaten/${zeile.id}`, {
          ...zeileBody(zeile),
          ...hinweis.aenderung,
          etag: hinweis.zeile!.etag,
        }),
      `Vorschlag für ${nameVon(hinweis) ?? 'die Zutat'} übernommen.`
    );
    if (!ok) return;
    uebernommen = [...uebernommen, index];
    // Further hints on the same line build on the change just saved
    const neu = gericht.zutaten.find((eintrag) => eintrag.id === zeile.id);
    for (const andere of pruefung?.hinweise ?? [])
      if (neu && andere.zeile?.id === zeile.id) andere.zeile.etag = neu.etag;
  }
</script>

<section class="space-y-2 print:hidden" aria-labelledby="gericht-{gericht.id}-ki">
  <h4 id="gericht-{gericht.id}-ki" class="sr-only">KI-Hilfe</h4>
  <div class="flex flex-wrap gap-2">
    <ActionButton
      type="button"
      disabled={prueft || !gericht.zutaten.length}
      onclick={() => void pruefen()}>{prueft ? 'KI prüft …' : 'Gericht prüfen (KI)'}</ActionButton
    >
    <ActionButton type="button" disabled={!katalog} onclick={() => (rezeptOffen = true)}
      >Rezept einfügen (KI)</ActionButton
    >
  </div>
  {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
  {#if pruefung}
    <div class="space-y-2 rounded-md border border-neutral-200 p-3" role="status">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-semibold text-brand-900">KI-Hinweise zu {gericht.name}</p>
        <ActionButton type="button" onclick={() => (pruefung = null)}>Ausblenden</ActionButton>
      </div>
      <p class="text-sm text-neutral-700">
        Von der KI erzeugt und ungeprüft. Entscheide selbst, was davon stimmt.
      </p>
      {#if pruefung.hinweise.length}
        <ul class="divide-y divide-neutral-200">
          {#each pruefung.hinweise as hinweis, index (index)}
            {@const name = nameVon(hinweis)}
            <li class="space-y-1 py-2">
              <p class="[overflow-wrap:anywhere]">
                {#if name}<span class="font-semibold">{name}:</span>{/if}
                {hinweis.text}
              </p>
              {#if hinweis.vorschlag}
                <p class="text-sm text-neutral-700 [overflow-wrap:anywhere]">
                  Vorschlag: {hinweis.vorschlag}
                </p>
              {/if}
              {#if hinweis.aenderung && name}
                {#if uebernommen.includes(index)}
                  <p class="text-sm text-success">Übernommen.</p>
                {:else}
                  <ActionButton
                    type="button"
                    disabled={kontext.busy}
                    aria-label="Vorschlag für {name} übernehmen: {aenderungText(hinweis.aenderung)}"
                    onclick={() => void uebernehmen(index, hinweis)}
                    >Übernehmen: {aenderungText(
                      hinweis.aenderung,
                      zutaten.get(zeileVon(hinweis)?.planungZutatId ?? 0)?.abtropfgewicht
                    )}</ActionButton
                  >
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p>Die KI hat nichts Auffälliges gefunden.</p>
      {/if}
    </div>
  {/if}
</section>

{#if katalog && rezeptOffen}
  <RezeptImportDialog
    {kontext}
    {katalog}
    {gericht}
    open={rezeptOffen}
    onclose={() => (rezeptOffen = false)}
  />
{/if}
