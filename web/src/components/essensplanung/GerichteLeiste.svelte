<script lang="ts">
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import { plaetzeVon } from '../../lib/essensplanungEinplanung';
  import { passtZurSuche } from '../../lib/essensplanungPlan';
  import { personenFehlen } from '../../lib/essensplanungRechnung';
  import { beende, starte } from './planZiehen.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * All dishes of the Planung next to the plan, also those not planned yet, with a search. A dish
   * is dragged from here into a meal; a click opens it. Folded on small screens, where dragging
   * does not work and dishes are typed into the meals instead.
   */

  interface Props {
    kontext: PlanKontext;
    bearbeiten: boolean;
  }
  let { kontext, bearbeiten }: Props = $props();

  let suche = $state('');
  /** Open from the start on wide screens only. */
  const breit = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  const gerichte = $derived(
    kontext.ansicht.gerichte
      .filter((g) => passtZurSuche(g.name, suche))
      .map((gericht) => ({ gericht, plaetze: plaetzeVon(kontext.ansicht, gericht.id).length }))
  );
</script>

<details class="surface group/leiste text-sm" open={breit}>
  <summary
    class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-brand-900 any-pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
    >Alle Gerichte <span class="font-normal text-neutral-700"
      >({kontext.ansicht.gerichte.length})</span
    ><AufklappPfeil class="ml-auto" /></summary
  >
  <div class="space-y-2 border-t border-neutral-200 p-2">
    <label class="sr-only" for="leiste-suche">Gerichte durchsuchen</label>
    <input
      id="leiste-suche"
      type="search"
      class="form-input mt-0 min-h-0 px-2 py-1 text-sm any-pointer-coarse:min-h-11"
      placeholder="Suchen"
      autocomplete="off"
      bind:value={suche}
    />
    <ul class="max-h-[60vh] space-y-1 overflow-y-auto" aria-label="Alle Gerichte">
      {#each gerichte as { gericht, plaetze } (gericht.id)}
        <li
          class="flex items-center gap-2 rounded-sm border border-neutral-200 bg-surface px-2 py-1 {bearbeiten
            ? 'cursor-grab'
            : ''}"
          draggable={bearbeiten}
          ondragstart={(event) =>
            starte(event, { art: 'gericht', gerichtId: gericht.id, name: gericht.name })}
          ondragend={beende}
        >
          {#if bearbeiten}<span class="text-neutral-500 select-none" aria-hidden="true">⠿</span
            >{/if}
          <!-- The name is where it is dragged from; a button there would not start dragging -->
          <span class="min-w-0 flex-1 font-semibold break-words hyphens-auto">{gericht.name}</span>
          <span
            class="shrink-0 text-xs tabular-nums {plaetze
              ? 'text-neutral-700'
              : 'font-semibold text-warning'}"
            title={plaetze ? 'So oft eingeplant' : 'Nicht eingeplant'}
            ><span aria-hidden="true">{plaetze}×</span><span class="sr-only"
              >{plaetze ? `${plaetze}-mal eingeplant` : 'nicht eingeplant'}</span
            ></span
          >
          {#if personenFehlen(gericht)}<span
              class="size-2 shrink-0 rounded-full bg-warning"
              title="Personenzahl fehlt"
              aria-label="Personenzahl fehlt"
              role="img"
            ></span>{/if}
          <button
            type="button"
            class="flex size-6 shrink-0 items-center justify-center rounded-sm text-neutral-700 hover:bg-neutral-100 hover:text-link any-pointer-coarse:size-11"
            title="Gericht öffnen"
            aria-label="{gericht.name} öffnen"
            onclick={() => kontext.oeffneGericht(gericht.id)}
            ><svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg
            ></button
          >
        </li>
      {:else}
        <li class="px-1 text-neutral-700">
          {kontext.ansicht.gerichte.length ? 'Kein Gericht passt.' : 'Noch keine Gerichte.'}
        </li>
      {/each}
    </ul>
  </div>
</details>
