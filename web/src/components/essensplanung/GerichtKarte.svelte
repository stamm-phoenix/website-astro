<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import GerichtKi from './GerichtKi.svelte';
  import GerichtGenerierenKnopf from './GerichtGenerierenKnopf.svelte';
  import ProtokollText from '../protokolle/ProtokollText.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { plaetzeVon } from '../../lib/essensplanungEinplanung';
  import {
    einheitText,
    gerichtStand,
    gerichtWarnungen,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { EssenKatalog, Gericht } from '../../../../api/lib/essen-gerichte-model';
  import GerichtKopf from './GerichtKopf.svelte';
  import GerichtPlaetze from './GerichtPlaetze.svelte';
  import { angefangen, leereZeile } from './NeueZutatZeile.svelte';
  import GerichtZutatenListe from './GerichtZutatenListe.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import { gespeichert, meldeVerloren, type PlanKontext } from './planKontext';

  /**
   * One dish: its lines with warnings, and (for those who edit) its fields, which save on their
   * own (`GerichtKopf.svelte`). Printed alone as a recipe card.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    bearbeiten: boolean;
    /** True while the card is open in the shown tab. */
    sichtbar: boolean;
    /** Downloads the recipe card of the dish. */
    onpdf: () => Promise<void>;
  }
  let { kontext, katalog, gericht, bearbeiten, sichtbar, onpdf }: Props = $props();

  /** The editor loads once the card is first shown and then stays, keeping its state. */
  let editorGeladen = $state(false);
  $effect(() => {
    if (sichtbar) editorGeladen = true;
  });
  const ansicht = $derived(kontext.ansicht);
  const zutaten = $derived(new Map(ansicht.zutaten.map((zutat) => [zutat.id, zutat])));
  const unvertraeglichkeiten = $derived(
    new Map((katalog?.unvertraeglichkeiten ?? []).map((u) => [u.id, u.name]))
  );
  const warnungen = $derived(gerichtWarnungen(gericht, zutaten));

  /** The new row of ingredients; kept here, so a read-only phase does not lose it. */
  let neueZeile = $state(leereZeile());
  $effect(() => guardUnsavedChanges(() => angefangen(neueZeile)));

  /** Set when this page deletes the dish itself, which needs no word about lost input. */
  let selbstGeloescht = false;
  // Someone else deleted the dish: the card goes, so the started row is shown to copy
  $effect(() => () => {
    const neu = neueZeile;
    if (selbstGeloescht || !angefangen(neu)) return;
    const eingabe = [
      neu.name.trim(),
      neu.menge.trim() && `${neu.menge.trim()} ${einheitText(neu.einheit)}`,
      neu.hinweis.trim(),
    ]
      .filter(Boolean)
      .join(', ');
    meldeVerloren(
      kontext,
      `„${gericht.name}“ wurde gerade gelöscht. Deine ungespeicherte neue Zutat: ${eingabe}`
    );
  });

  async function loeschen(): Promise<void> {
    // A row left with this click saves first, so the version asked about includes it
    await gespeichert();
    // The dish as asked about: a change of others during the question is a conflict
    const { id, name } = gericht;
    const etag = gerichtStand(
      gericht,
      plaetze.map((platz) => platz.einplanung.etag)
    );
    const anzahl = plaetze.length;
    if (
      !(await confirmAction({
        title: `„${name}“ löschen?`,
        message: `Das Gericht wird mit allen ${gericht.zutaten.length} Zutaten gelöscht${anzahl ? ` und aus ${anzahl === 1 ? 'seiner Mahlzeit' : `${anzahl} Mahlzeiten`} genommen` : ''}.`,
        confirmLabel: 'Gericht löschen',
      }))
    )
      return;
    selbstGeloescht = true;
    const ok = await kontext.aendern(
      () => kontext.api.senden('DELETE', `/gerichte/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
    if (!ok) selbstGeloescht = false;
  }

  /** Where the dish is planned. */
  const plaetze = $derived(plaetzeVon(ansicht, gericht.id));
</script>

<div class="space-y-4">
  <!-- Everything about the dish itself on top, the ingredients clearly apart below -->
  <section class="surface-muted space-y-3 rounded-md p-3" aria-label="Angaben zu {gericht.name}">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="space-y-1">
        <p class="text-neutral-700">
          {gericht.personen === null ? 'Feste Mengen' : `Mengen für ${gericht.personen} Personen`}
        </p>
        <GerichtPlaetze {plaetze} />
      </div>
      <div class="flex flex-wrap gap-2 print:hidden">
        <!-- Stays during maintenance, so a dish being written is not lost; its actions wait -->
        {#if ansicht.zugang !== 'lesen'}
          <GerichtGenerierenKnopf {kontext} {katalog} {gericht} {bearbeiten} />
        {/if}
        <!-- Only with the list, so the card names all allergens -->
        <PdfKnopf
          {kontext}
          label="Rezeptkarte als PDF"
          ariaLabel="Rezeptkarte als PDF: {gericht.name}"
          disabled={!katalog}
          erstellen={onpdf}
        />
        {#if bearbeiten}
          <ActionButton
            type="button"
            variant="danger"
            disabled={kontext.busy}
            onclick={() => void loeschen()}
          >
            Gericht löschen
          </ActionButton>
        {/if}
      </div>
    </div>

    {#if bearbeiten}
      <GerichtKopf {kontext} {gericht} {editorGeladen} selbstGeloescht={() => selbstGeloescht} />
    {/if}

    <!-- Read-only and for the recipe card -->
    <div class={bearbeiten ? 'hidden space-y-3 print:block' : 'space-y-3'}>
      {#if gericht.anleitung}
        <div>
          <h4 class="font-semibold text-brand-900">Anleitung</h4>
          <div class="[overflow-wrap:anywhere]">
            <ProtokollText text={gericht.anleitung} headingLevel={5} />
          </div>
        </div>
      {/if}
      {#if gericht.werkzeuge.length}
        <div>
          <h4 class="font-semibold text-brand-900">Werkzeuge</h4>
          <p>{gericht.werkzeuge.join(', ')}</p>
        </div>
      {/if}
      {#if gericht.links.length}
        <div>
          <h4 class="font-semibold text-brand-900">Links</h4>
          <ul>
            {#each gericht.links as link, index (index)}
              <li class="[overflow-wrap:anywhere]">
                <a
                  class="text-link underline"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.titel || link.url}
                </a>
                <!-- Paper has no links: the address is printed after the title -->
                {#if link.titel}<span class="hidden print:inline">({link.url})</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if gericht.notiz}
        <div>
          <h4 class="font-semibold text-brand-900">Notiz</h4>
          <p class="whitespace-pre-line [overflow-wrap:anywhere]">{gericht.notiz}</p>
        </div>
      {/if}
    </div>
  </section>

  <section class="space-y-3 border-t-2 border-neutral-300 pt-4">
    <GerichtZutatenListe
      {kontext}
      {katalog}
      {gericht}
      {bearbeiten}
      {zutaten}
      {unvertraeglichkeiten}
      bind:neueZeile
    />

    {#if warnungen.length}
      <ul class="space-y-1 border-l-4 border-warning py-1 pl-3 text-sm text-warning" role="status">
        {#each warnungen as warnung, index (index)}
          <li>{warnung.text}</li>
        {/each}
      </ul>
    {/if}

    <!-- Stays during maintenance, so a recipe being read is not lost; its actions wait -->
    {#if ansicht.zugang !== 'lesen'}<GerichtKi
        {kontext}
        {katalog}
        {gericht}
        {zutaten}
        {bearbeiten}
      />{/if}
  </section>
</div>
