<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import type { EinkaufListe } from '../../lib/essensplanungEinkaeufe';
  import EinkaufForm from './EinkaufForm.svelte';
  import { einkaufInfo } from './einkaufInfo';
  import { KNOPF } from './einkaufHerkunft.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The shopping trips of a Planung (`docs/essensplanung.md`, Einkäufe) in the order they are
   * bought, one row each; a trip opens in a view of its own.
   */

  interface Props {
    kontext: PlanKontext;
    /** The lists of the trips, in the order they are bought. */
    listen: EinkaufListe[];
    katalogGeladen: boolean;
    onoeffnen: (einkaufId: number, modus: 'live' | 'liste' | null) => void;
  }
  let { kontext, listen, katalogGeladen, onoeffnen }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  let anlegen = $state(false);
</script>

<section aria-labelledby="einkaeufe-heading" class="space-y-1">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="einkaeufe-heading" class="font-serif text-lg font-bold text-brand-900">Einkäufe</h3>
    {#if bearbeiten && !anlegen}
      <ActionButton type="button" class={KNOPF} onclick={() => (anlegen = true)}
        >Einkauf anlegen</ActionButton
      >
    {/if}
  </div>
  {#if listen.length}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-300" aria-label="Einkäufe">
      {#each listen as liste (liste.einkauf.id)}
        {@const einkauf = liste.einkauf}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
          <div class="min-w-0 flex-1 basis-48">
            <button
              type="button"
              class="flex min-h-8 items-center gap-1 text-left font-semibold text-link [overflow-wrap:anywhere] any-pointer-coarse:min-h-11"
              onclick={() => onoeffnen(einkauf.id, null)}
              >{einkauf.name}<span aria-hidden="true">›</span></button
            >
            <p class="text-xs text-neutral-700">
              {einkaufInfo(ansicht, einkauf)}{#if einkauf.abgeschlossen}
                · <span class="font-semibold">abgeschlossen</span>{/if}
            </p>
          </div>
          <span class="flex items-center gap-2 text-xs tabular-nums">
            <span class="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200" aria-hidden="true">
              <span
                class="block h-full bg-success"
                style:width="{liste.anzahl ? (liste.abgehakt / liste.anzahl) * 100 : 0}%"
              ></span>
            </span>
            {liste.abgehakt} von {liste.anzahl} abgehakt
          </span>
          {#if bearbeiten && !einkauf.abgeschlossen}
            <ActionButton
              type="button"
              variant="primary"
              class={KNOPF}
              disabled={!katalogGeladen}
              aria-label="{einkauf.name}: Einkaufen"
              onclick={() => onoeffnen(einkauf.id, 'live')}>Einkaufen</ActionButton
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-neutral-700">Noch keine Einkäufe.</p>
  {/if}
  <!-- A started form stays while the page is read-only for a while, so the draft is kept -->
  {#if anlegen}
    <EinkaufForm
      {kontext}
      einkauf={null}
      gesperrt={!bearbeiten}
      onfertig={() => (anlegen = false)}
    />
  {/if}
</section>
