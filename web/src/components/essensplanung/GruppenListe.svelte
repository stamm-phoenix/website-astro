<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import QuerScroll from '../ui/QuerScroll.svelte';
  import { confirmAction } from '../../lib/confirm';
  import {
    ERNAEHRUNG_TEXT,
    ERNAEHRUNGEN,
    jeErnaehrung,
    zahlText,
  } from '../../lib/essensplanungTeilnehmende';
  import type { PlanungGruppe } from '../../lib/types';
  import { DARSTELLUNGEN, darstellungMerken } from './darstellungMerken.svelte';
  import { KNOPF } from './einkaufHerkunft.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The groups of a Planung with their factor and persons, as a dense list or as a matrix of
   * groups and diets.
   */

  interface Props {
    kontext: PlanKontext;
    /** Opens the dialog of a group; null adds one. */
    onbearbeiten: (id: number | null) => void;
  }
  let { kontext, onbearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** List or matrix; each viewer's choice is remembered in this browser. */
  const darstellung = darstellungMerken('essensplanung:gruppen-darstellung');

  const zahlen = $derived(
    new Map(
      ansicht.gruppen.map((g) => {
        const je = jeErnaehrung(ansicht.teilnehmende.filter((z) => z.gruppeId === g.id));
        return [g.id, { je, personen: je.alles + je.vegetarisch + je.vegan }];
      })
    )
  );
  const summe = $derived(jeErnaehrung(ansicht.teilnehmende));
  const personen = (gruppe: PlanungGruppe): number => zahlen.get(gruppe.id)?.personen ?? 0;

  async function loeschen(gruppe: PlanungGruppe): Promise<void> {
    const { id, etag, name } = gruppe;
    if (
      !(await confirmAction({
        title: `Gruppe ${name} löschen?`,
        message: 'Die Gruppe verschwindet aus dieser Planung.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/gruppen/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
  }

  const KOPF =
    'border-b border-l border-neutral-300 bg-neutral-100 px-2 py-1 align-bottom text-xs font-semibold text-neutral-700';
  const ZELLE = 'border-b border-l border-neutral-200 px-2 py-0.5 text-center tabular-nums';
</script>

{#snippet aktionen(gruppe: PlanungGruppe)}
  <span class="flex shrink-0 gap-1 print:hidden">
    <ActionButton
      type="button"
      class={KNOPF}
      aria-label="Gruppe {gruppe.name} ändern"
      onclick={() => onbearbeiten(gruppe.id)}>Ändern</ActionButton
    >
    {#if !personen(gruppe)}
      <ActionButton
        type="button"
        variant="danger"
        class={KNOPF}
        disabled={kontext.busy}
        aria-label="Gruppe {gruppe.name} löschen"
        onclick={() => void loeschen(gruppe)}>Löschen</ActionButton
      >
    {/if}
  </span>
{/snippet}

<section aria-labelledby="gruppen-heading" class="surface space-y-2 p-3">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <h3 id="gruppen-heading" class="font-serif text-lg font-bold text-brand-900">Gruppen</h3>
    <FilterTabs
      label="Darstellung der Gruppen"
      variant="segmented"
      options={DARSTELLUNGEN}
      value={darstellung.art}
      onselect={darstellung.zeige}
    />
    {#if bearbeiten}
      <ActionButton
        type="button"
        class="ml-auto print:hidden {KNOPF}"
        onclick={() => onbearbeiten(null)}>Gruppe hinzufügen</ActionButton
      >
    {/if}
  </div>
  {#if !ansicht.gruppen.length}
    <p class="text-sm text-neutral-700">Noch keine Gruppen.</p>
  {:else if darstellung.art === 'matrix'}
    <QuerScroll
      label="Gruppen als Matrix"
      hinweis="Weitere Spalten siehst du, wenn du seitlich wischst oder scrollst."
    >
      <table class="border-separate border-spacing-0 text-left text-sm">
        <caption class="sr-only">Gruppen als Matrix</caption>
        <thead>
          <tr>
            <th
              scope="col"
              class="sticky left-0 z-10 w-24 min-w-24 border-r border-b border-neutral-300 bg-neutral-100 px-2 py-1 align-bottom text-xs font-semibold text-neutral-700 md:w-40"
            >
              Gruppe
            </th>
            <th scope="col" class="{KOPF} w-16 text-center">Faktor</th>
            <th scope="col" class="{KOPF} w-20 text-center">Personen</th>
            {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
              <th scope="col" class="{KOPF} w-20 text-center">{ERNAEHRUNG_TEXT[ernaehrung]}</th>
            {/each}
            {#if bearbeiten}<th scope="col" class={KOPF}><span class="sr-only">Ändern</span></th
              >{/if}
          </tr>
        </thead>
        <tbody>
          {#each ansicht.gruppen as gruppe, g (gruppe.id)}
            {@const streifen = g % 2 === 1 ? 'bg-neutral-50' : 'bg-surface'}
            {@const je = zahlen.get(gruppe.id)?.je}
            <tr class={streifen} data-gruppe={gruppe.name}>
              <th
                scope="row"
                class="sticky left-0 z-10 border-r border-b border-neutral-300 px-2 py-0.5 font-semibold [overflow-wrap:anywhere] text-brand-900 {streifen}"
              >
                {gruppe.name}
              </th>
              <td class={ZELLE}>{zahlText(gruppe.faktor)}</td>
              <td class="{ZELLE} font-semibold" data-zahl>{personen(gruppe)}</td>
              {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
                <td class={ZELLE} data-zahl>{je?.[ernaehrung] || ''}</td>
              {/each}
              {#if bearbeiten}<td class="border-b border-l border-neutral-200 px-2 py-0.5"
                  >{@render aktionen(gruppe)}</td
                >{/if}
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="bg-neutral-100">
            <th
              scope="row"
              class="sticky left-0 z-10 border-r border-neutral-300 bg-neutral-100 px-2 py-1 font-semibold text-brand-900"
            >
              Insgesamt
            </th>
            <td class="border-l border-neutral-300"></td>
            <td class="border-l border-neutral-300 px-2 py-1 text-center font-bold tabular-nums"
              >{summe.alles + summe.vegetarisch + summe.vegan}</td
            >
            {#each ERNAEHRUNGEN as ernaehrung (ernaehrung)}
              <td class="border-l border-neutral-300 px-2 py-1 text-center font-bold tabular-nums"
                >{summe[ernaehrung]}</td
              >
            {/each}
            {#if bearbeiten}<td class="border-l border-neutral-300"></td>{/if}
          </tr>
        </tfoot>
      </table>
    </QuerScroll>
  {:else}
    <ul
      class="divide-y divide-neutral-200 border-y border-neutral-300 text-sm"
      aria-label="Gruppen"
    >
      {#each ansicht.gruppen as gruppe (gruppe.id)}
        <li class="flex items-center gap-2 py-0.5">
          <p class="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span class="font-semibold">{gruppe.name}</span>
            <span class="text-neutral-700"
              >Faktor {zahlText(gruppe.faktor)} · {personen(gruppe)} Personen</span
            >
          </p>
          {#if bearbeiten}{@render aktionen(gruppe)}{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
