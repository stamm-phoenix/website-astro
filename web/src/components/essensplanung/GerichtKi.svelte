<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { zeileBody } from '../../lib/essensplanungGerichte';
  import {
    aenderungText,
    kiFehlerText,
    type KiHinweis,
    type KiPruefung,
  } from '../../lib/essensplanungKi';
  import type {
    EssenKatalog,
    Gericht,
    GerichtZutat,
    PlanungAnsicht,
    PlanungZutat,
  } from '../../lib/types';
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
    /**
     * False while the Planung cannot be changed (maintenance): the component stays with what
     * was typed, only its actions wait.
     */
    bearbeiten: boolean;
  }
  let { kontext, katalog, gericht, zutaten, bearbeiten }: Props = $props();

  let pruefung = $state<KiPruefung | null>(null);
  let prueft = $state(false);
  let fehler = $state<string | null>(null);
  /** Indexes of the hints whose change was taken over. */
  let uebernommen = $state<number[]>([]);
  /** Indexes of hints whose proposal was dropped, because others changed the line meanwhile. */
  let veraltet = $state<number[]>([]);
  let rezeptOffen = $state(false);
  /** The people of the dish changed since the check: its amounts no longer fit. */
  const personenGeaendert = $derived(pruefung !== null && pruefung.personen !== gericht.personen);

  async function pruefen(): Promise<void> {
    prueft = true;
    fehler = null;
    pruefung = null;
    try {
      pruefung = await kontext.api.senden<KiPruefung>('POST', `/gerichte/${gericht.id}/ki/pruefen`);
      uebernommen = [];
      veraltet = [];
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
    const gesendet = { ...zeileBody(zeile), ...hinweis.aenderung, etag: hinweis.zeile.etag };
    // An amount is for the people that were checked: a change of them meanwhile is a conflict
    const body =
      hinweis.aenderung.menge !== undefined && pruefung
        ? { ...gesendet, personen: pruefung.personen }
        : gesendet;
    /** The line as this write left it, from the answer of the PATCH itself. */
    let geschrieben: GerichtZutat | undefined;
    const ok = await kontext.aendern(
      async () => {
        const ansicht = await kontext.api.senden<PlanungAnsicht>(
          'PATCH',
          `/gericht-zutaten/${zeile.id}`,
          body
        );
        geschrieben = ansicht.gerichte.flatMap((g) => g.zutaten).find((z) => z.id === zeile.id);
        return ansicht;
      },
      `Vorschlag für ${nameVon(hinweis) ?? 'die Zutat'} übernommen.`
    );
    if (!ok) return;
    uebernommen = [...uebernommen, index];
    // Further hints on the same line build on this write only. If the answer already shows a
    // change of others, they would overwrite it: their proposals are dropped instead.
    const eigene = geschrieben && gleicheZeile(geschrieben, gesendet);
    for (const [weiterer, andere] of (pruefung?.hinweise ?? []).entries()) {
      if (weiterer === index || andere.zeile?.id !== zeile.id) continue;
      if (eigene) andere.zeile.etag = geschrieben!.etag;
      else if (andere.aenderung) {
        andere.aenderung = undefined;
        veraltet = [...veraltet, weiterer];
      }
    }
  }

  /** Whether `zeile` holds exactly the fields that were sent. */
  function gleicheZeile(zeile: GerichtZutat, body: ReturnType<typeof zeileBody>): boolean {
    const felder = [
      'planungZutatId',
      'menge',
      'einheit',
      'fest',
      'fuerAlles',
      'fuerVegetarisch',
      'fuerVegan',
      'ohne',
      'nur',
      'hinweis',
    ] as const;
    return felder.every((feld) => JSON.stringify(zeile[feld]) === JSON.stringify(body[feld]));
  }
</script>

<section class="space-y-2 print:hidden" aria-labelledby="gericht-{gericht.id}-ki">
  <h4 id="gericht-{gericht.id}-ki" class="sr-only">KI-Hilfe</h4>
  <div class="flex flex-wrap gap-2">
    <ActionButton
      type="button"
      disabled={!bearbeiten || prueft || !gericht.zutaten.length}
      onclick={() => void pruefen()}>{prueft ? 'KI prüft …' : 'Gericht prüfen (KI)'}</ActionButton
    >
    <ActionButton
      type="button"
      disabled={!bearbeiten || !katalog}
      onclick={() => (rezeptOffen = true)}>Rezept einfügen (KI)</ActionButton
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
      {#if personenGeaendert}
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-sm text-warning">
            Die Personenzahl des Gerichts hat sich seit der Prüfung geändert; vorgeschlagene Mengen
            gelten nicht mehr.
          </p>
          <ActionButton
            type="button"
            disabled={!bearbeiten || prueft}
            onclick={() => void pruefen()}>Gericht neu prüfen</ActionButton
          >
        </div>
      {/if}
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
              {#if veraltet.includes(index)}
                <p class="text-sm text-warning">
                  Die Zutat wurde inzwischen auch anderweitig geändert. Lass das Gericht noch einmal
                  prüfen.
                </p>
              {/if}
              {#if hinweis.aenderung && name && !(personenGeaendert && hinweis.aenderung.menge !== undefined && !uebernommen.includes(index))}
                {#if uebernommen.includes(index)}
                  <p class="text-sm text-success">Übernommen.</p>
                {:else}
                  <ActionButton
                    type="button"
                    disabled={!bearbeiten || kontext.busy}
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
    {bearbeiten}
    open={rezeptOffen}
    onclose={() => (rezeptOffen = false)}
  />
{/if}
