<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    auswahlVon,
    gefiltert,
    packliste,
    packlisteDruck,
    type PackAuswahl,
    type PackFilter,
    type PackZeile as Zeile,
  } from '../../lib/essensplanungPackliste';
  import NeuerPackEintrag from './NeuerPackEintrag.svelte';
  import { DARSTELLUNGEN, darstellungMerken } from './darstellungMerken.svelte';
  import PackMatrix from './PackMatrix.svelte';
  import PackWerDialog from './PackWerDialog.svelte';
  import PackZeile from './PackZeile.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import { personenSpeichern } from './packSpeichern';
  import type { PlanKontext } from './planKontext';

  /**
   * The packing list of a Planung: the tools of all planned dishes and the entries of its own,
   * each with the persons who pack it, each with their own box. Shown as a list or as a matrix
   * of persons and things.
   */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  const zeilen = $derived(packliste(ansicht));
  /**
   * The name typed under the list and who packs it, kept while the field is hidden (maintenance)
   * and while the matrix shows. Who packs stays for the next thing.
   */
  let neuerName = $state('');
  let neuerWer = $state<PackAuswahl>({ mitglieder: [], namen: [] });

  /** The row whose persons are being chosen, as the dialog opened with it. */
  let wahlZeile = $state<Zeile | null>(null);
  function waehleWer(zeile: Zeile): void {
    wahlZeile = zeile;
  }

  /** List or matrix; each viewer's choice is remembered in this browser. */
  const darstellung = darstellungMerken('essensplanung:packliste-darstellung');
  $effect(() => guardUnsavedChanges(() => neuerName.trim() !== ''));
  let filter = $state<PackFilter>('alle');
  const sichtbar = $derived(gefiltert(zeilen, filter, ansicht.ichId));
  const filterOptionen = $derived([
    { value: 'alle', label: 'Alle', count: zeilen.length },
    { value: 'offen', label: 'Noch einpacken', count: gefiltert(zeilen, 'offen', null).length },
    { value: 'gepackt', label: 'Gepackt', count: gefiltert(zeilen, 'gepackt', null).length },
    ...(ansicht.ichId !== null
      ? [
          {
            value: 'meine',
            label: 'Meine',
            count: gefiltert(zeilen, 'meine', ansicht.ichId).length,
          },
        ]
      : []),
  ] as { value: PackFilter; label: string; count: number }[]);
</script>

<section aria-labelledby="packliste-heading" class="surface space-y-2 p-4">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <h3 id="packliste-heading" class="font-serif text-lg font-bold text-brand-900">Packliste</h3>
    <FilterTabs
      label="Darstellung der Packliste"
      variant="segmented"
      options={DARSTELLUNGEN}
      value={darstellung.art}
      onselect={darstellung.zeige}
    />
    {#if zeilen.length}
      <FilterTabs
        label="Packliste zeigen"
        options={filterOptionen}
        value={filter}
        onselect={(value) => (filter = value)}
      />
    {/if}
    <div class="ml-auto">
      <PdfKnopf
        {kontext}
        label="Packliste als PDF"
        erstellen={async () => {
          const { downloadPacklistePdf } = await import('../../lib/essensplanungPdf');
          await downloadPacklistePdf(ansicht, packlisteDruck(zeilen));
        }}
      />
    </div>
  </div>
  {#if zeilen.length}
    {#if bearbeiten}
      <p class="text-sm text-neutral-700">Häkchen werden sofort gespeichert.</p>
    {/if}
    {#if !sichtbar.length}
      <p class="text-neutral-700">
        {filter === 'offen'
          ? 'Alles ist eingepackt.'
          : filter === 'gepackt'
            ? 'Noch nichts eingepackt.'
            : 'Für dich ist nichts eingetragen.'}
      </p>
    {:else if darstellung.art === 'matrix'}
      <PackMatrix {kontext} {zeilen} {sichtbar} {bearbeiten} onwer={waehleWer} />
    {:else}
      <div
        class="hidden border-b border-neutral-300 px-1 pb-0.5 text-xs font-semibold text-neutral-700 md:grid md:grid-cols-[minmax(0,1fr)_14rem_8rem] md:gap-x-3"
        aria-hidden="true"
      >
        <span>{bearbeiten ? 'Gepackt · ' : ''}Was · für welche Gerichte</span>
        <span>Wer packt</span>
      </div>
      <ul class="divide-y divide-neutral-200 border-b border-neutral-200" aria-label="Packliste">
        {#each sichtbar as zeile (zeile.key)}
          <PackZeile {kontext} {zeile} {bearbeiten} onwer={waehleWer} />
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="text-neutral-700">
      Noch nichts einzupacken. Werkzeuge der eingeplanten Gerichte stehen hier von selbst.
    </p>
  {/if}
  {#if bearbeiten}
    <NeuerPackEintrag {kontext} bind:text={neuerName} bind:wer={neuerWer} />
  {/if}
</section>

<PackWerDialog
  {kontext}
  was={wahlZeile?.name}
  zeile={wahlZeile}
  start={wahlZeile ? auswahlVon(wahlZeile) : { mitglieder: [], namen: [] }}
  submitLabel="Speichern"
  onwahl={(auswahl) =>
    personenSpeichern(
      kontext,
      wahlZeile!,
      zeilen.find((z) => z.key === wahlZeile!.key) ?? wahlZeile!,
      auswahl
    )}
  onclose={() => (wahlZeile = null)}
/>
