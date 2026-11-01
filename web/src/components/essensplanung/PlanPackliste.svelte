<script lang="ts">
  import { untrack } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    gefiltert,
    packliste,
    packlisteDruck,
    type PackFilter,
  } from '../../lib/essensplanungPackliste';
  import NeuerPackEintrag from './NeuerPackEintrag.svelte';
  import PackMatrix from './PackMatrix.svelte';
  import PackZeile from './PackZeile.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import { packEntwuerfe } from './packEntwuerfe.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The packing list of a Planung: the tools of all planned dishes and the entries of its own,
   * each packed with one box and with who packs it. Shown as a list or as a matrix of persons
   * and things.
   */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  const zeilen = $derived(packliste(ansicht));
  /**
   * Free names typed at rows, by row key. Kept here, so a filter that hides a row or the switch
   * to read-only (maintenance) does not drop what is typed; leaving asks while one is unsaved.
   */
  const entwuerfe = packEntwuerfe(
    () => kontext,
    () => zeilen
  );
  /**
   * The name typed under the list and who packs it, kept while the field is hidden (maintenance)
   * and while the matrix shows. Who packs stays for the next thing.
   */
  let neuerName = $state('');
  let neuerWer = $state('');
  let neuerWerText = $state('');

  /** List or matrix; each viewer's choice is remembered in this browser. */
  const DARSTELLUNG_KEY = 'essensplanung:packliste-darstellung';
  let darstellung = $state<'liste' | 'matrix'>(gemerkteDarstellung());
  function gemerkteDarstellung(): 'liste' | 'matrix' {
    try {
      return localStorage.getItem(DARSTELLUNG_KEY) === 'matrix' ? 'matrix' : 'liste';
    } catch {
      return 'liste';
    }
  }
  function zeige(art: 'liste' | 'matrix'): void {
    darstellung = art;
    try {
      localStorage.setItem(DARSTELLUNG_KEY, art);
    } catch {
      // Without storage the choice holds until the page is left
    }
  }
  $effect(() => guardUnsavedChanges(() => neuerName.trim() !== '' || entwuerfe.offen()));
  // A row gone with a draft, e.g. as someone else took the last dish with its tool out of the
  // plan: what was typed is named to copy, then the draft goes
  $effect(() => {
    void zeilen;
    untrack(() => entwuerfe.abgleichen());
  });
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

<section aria-labelledby="packliste-heading" class="space-y-2">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <h3 id="packliste-heading" class="font-serif text-lg font-bold text-brand-900">Packliste</h3>
    <FilterTabs
      label="Darstellung der Packliste"
      variant="segmented"
      options={[
        { value: 'liste', label: 'Liste' },
        { value: 'matrix', label: 'Matrix' },
      ]}
      value={darstellung}
      onselect={zeige}
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
    {:else if darstellung === 'matrix'}
      <PackMatrix {kontext} {zeilen} {sichtbar} {bearbeiten} {entwuerfe} />
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
          <PackZeile
            {kontext}
            {zeile}
            {bearbeiten}
            entwurf={entwuerfe.von(zeile.key)}
            aktionen={entwuerfe.aktionen(zeile.key)}
          />
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="text-neutral-700">
      Noch nichts einzupacken. Werkzeuge der eingeplanten Gerichte stehen hier von selbst.
    </p>
  {/if}
  {#if bearbeiten}
    <NeuerPackEintrag
      {kontext}
      bind:text={neuerName}
      bind:wer={neuerWer}
      bind:werText={neuerWerText}
    />
  {/if}
</section>
