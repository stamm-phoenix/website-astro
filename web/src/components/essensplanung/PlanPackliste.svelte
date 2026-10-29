<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    entwurfOffen,
    gefiltert,
    packliste,
    packlisteDruck,
    type PackFilter,
  } from '../../lib/essensplanungPackliste';
  import NeuerPackEintrag from './NeuerPackEintrag.svelte';
  import PackZeile from './PackZeile.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The packing list of a Planung: the tools of all planned dishes and the entries of its own,
   * each packed with one box and with who packs it.
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
  let entwuerfe = $state<Record<string, string>>({});
  /** The name typed under the list, kept while the field is hidden (maintenance). */
  let neuerName = $state('');
  $effect(() =>
    guardUnsavedChanges(() => neuerName.trim() !== '' || entwurfOffen(entwuerfe, zeilen))
  );
  function entwurfSetzen(key: string, text: string | null): void {
    if (text === null) {
      entwuerfe = Object.fromEntries(Object.entries(entwuerfe).filter(([k]) => k !== key));
    } else entwuerfe = { ...entwuerfe, [key]: text };
  }
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

<section aria-labelledby="packliste-heading" class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="packliste-heading" class="font-serif text-lg font-bold text-brand-900">Packliste</h3>
    <PdfKnopf
      {kontext}
      label="Packliste als PDF"
      erstellen={async () => {
        const { downloadPacklistePdf } = await import('../../lib/essensplanungPdf');
        await downloadPacklistePdf(ansicht, packlisteDruck(zeilen));
      }}
    />
  </div>
  {#if zeilen.length}
    <FilterTabs
      label="Packliste zeigen"
      options={filterOptionen}
      value={filter}
      onselect={(value) => (filter = value)}
    />
    {#if bearbeiten}
      <p class="text-sm text-neutral-700">Häkchen werden sofort gespeichert.</p>
    {/if}
    {#if sichtbar.length}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Packliste">
        {#each sichtbar as zeile (zeile.key)}
          <PackZeile
            {kontext}
            {zeile}
            {bearbeiten}
            entwurf={entwuerfe[zeile.key] ?? null}
            onentwurf={(text) => entwurfSetzen(zeile.key, text)}
          />
        {/each}
      </ul>
    {:else}
      <p class="text-neutral-700">
        {filter === 'offen'
          ? 'Alles ist eingepackt.'
          : filter === 'gepackt'
            ? 'Noch nichts eingepackt.'
            : 'Für dich ist nichts eingetragen.'}
      </p>
    {/if}
  {:else}
    <p class="text-neutral-700">
      Noch nichts einzupacken. Werkzeuge der eingeplanten Gerichte stehen hier von selbst.
    </p>
  {/if}
  {#if bearbeiten}
    <NeuerPackEintrag {kontext} bind:text={neuerName} />
  {/if}
</section>
