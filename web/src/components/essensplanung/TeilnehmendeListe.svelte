<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import { confirmAction } from '../../lib/confirm';
  import {
    ERNAEHRUNG_TEXT,
    unvertraeglichkeitenNamen,
    zeitraumText,
  } from '../../lib/essensplanungTeilnehmende';
  import type { Teilnehmende } from '../../lib/types';
  import { DARSTELLUNGEN, darstellungMerken } from './darstellungMerken.svelte';
  import { KNOPF } from './einkaufHerkunft.svelte';
  import TeilnehmendeMatrix from './TeilnehmendeMatrix.svelte';
  import type { PlanKontext } from './planKontext';

  /** The participants of a Planung by group, as a dense list or as a matrix of the diets. */

  interface Props {
    kontext: PlanKontext;
    /** The names of the intolerances; empty while their list is missing. */
    unvertraeglichkeit: Map<number, string>;
    katalogFehler: string | null;
    onkatalog: () => void;
    /** Opens the dialog of a row; null adds one. */
    onbearbeiten: (id: number | null) => void;
  }
  let { kontext, unvertraeglichkeit, katalogFehler, onkatalog, onbearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);
  const gruppenName = $derived(new Map(ansicht.gruppen.map((g) => [g.id, g.name])));
  const insgesamt = $derived(ansicht.teilnehmende.reduce((summe, z) => summe + z.anzahl, 0));

  /** List or matrix; each viewer's choice is remembered in this browser. */
  const darstellung = darstellungMerken('essensplanung:teilnehmende-darstellung');

  function zeileText(zeile: Teilnehmende): string {
    const ohne = unvertraeglichkeitenNamen(zeile, unvertraeglichkeit);
    return [
      ERNAEHRUNG_TEXT[zeile.ernaehrung],
      ohne.length ? `Unverträglichkeiten: ${ohne.join(', ')}` : '',
      zeitraumText(ansicht, zeile),
      zeile.hinweis,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** „4 Pfadi vegetarisch“, for the names of the buttons. */
  function zeileName(zeile: Teilnehmende): string {
    return `${zeile.anzahl} ${gruppenName.get(zeile.gruppeId) ?? ''} ${ERNAEHRUNG_TEXT[zeile.ernaehrung]}`;
  }

  async function entfernen(zeile: Teilnehmende): Promise<void> {
    const { id, etag, anzahl } = zeile;
    const gruppe = gruppenName.get(zeile.gruppeId) ?? '';
    if (
      !(await confirmAction({
        title: `${anzahl} ${gruppe} entfernen?`,
        message: 'Die Zeile verschwindet aus den Teilnehmenden.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/teilnehmende/${id}`, undefined, etag),
      `${anzahl} ${gruppe} entfernt.`
    );
  }
</script>

{#snippet aktionen(zeile: Teilnehmende)}
  <span class="flex shrink-0 gap-1 print:hidden">
    <ActionButton
      type="button"
      class={KNOPF}
      aria-label="{zeileName(zeile)} ändern"
      onclick={() => onbearbeiten(zeile.id)}>Ändern</ActionButton
    >
    <ActionButton
      type="button"
      variant="danger"
      class={KNOPF}
      disabled={kontext.busy}
      aria-label="{zeileName(zeile)} entfernen"
      onclick={() => void entfernen(zeile)}>Entfernen</ActionButton
    >
  </span>
{/snippet}

<section aria-labelledby="teilnehmende-heading" class="surface space-y-2 p-3">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <h3 id="teilnehmende-heading" class="font-serif text-lg font-bold text-brand-900">
      Teilnehmende
    </h3>
    <FilterTabs
      label="Darstellung der Teilnehmenden"
      variant="segmented"
      options={DARSTELLUNGEN}
      value={darstellung.art}
      onselect={darstellung.zeige}
    />
    <p class="text-sm text-neutral-700">Insgesamt {insgesamt} Personen</p>
    {#if bearbeiten && ansicht.gruppen.length}
      <ActionButton
        type="button"
        class="ml-auto print:hidden {KNOPF}"
        onclick={() => onbearbeiten(null)}>Teilnehmende hinzufügen</ActionButton
      >
    {/if}
  </div>
  {#if katalogFehler}
    <p class="text-sm text-danger print:hidden" role="alert">
      {katalogFehler}
      <button type="button" class="min-h-11 font-semibold underline" onclick={onkatalog}
        >Noch einmal versuchen</button
      >
    </p>
  {/if}
  {#if !ansicht.teilnehmende.length}
    <p class="text-sm text-neutral-700">Noch keine Teilnehmenden.</p>
  {:else if darstellung.art === 'matrix'}
    <TeilnehmendeMatrix
      {ansicht}
      {unvertraeglichkeit}
      aktionen={bearbeiten ? aktionen : undefined}
    />
  {:else}
    {#each ansicht.gruppen as gruppe (gruppe.id)}
      {@const zeilen = ansicht.teilnehmende.filter((z) => z.gruppeId === gruppe.id)}
      {#if zeilen.length}
        <div>
          <h4 class="text-sm font-semibold text-brand-900">{gruppe.name}</h4>
          <ul
            class="divide-y divide-neutral-200 border-y border-neutral-300 text-sm"
            aria-label="Teilnehmende {gruppe.name}"
          >
            {#each zeilen as zeile (zeile.id)}
              <li class="flex items-center gap-2 py-0.5">
                <p class="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span class="font-semibold tabular-nums">{zeile.anzahl}</span>
                  <span class="text-neutral-700">{zeileText(zeile)}</span>
                </p>
                {#if bearbeiten}{@render aktionen(zeile)}{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
  {/if}
</section>
