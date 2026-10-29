<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { einkaufListen, einkaufsReihenfolge } from '../../lib/essensplanungEinkaeufe';
  import EinkaufForm from './EinkaufForm.svelte';
  import EinkaufKarte from './EinkaufKarte.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * The shopping trips of a Planung (`docs/essensplanung.md`, Einkäufe), in the order they are
   * bought, each with its list and the live mode.
   */

  interface Props {
    kontext: PlanKontext;
    /** Names of the categories of the central list. */
    kategorien: Map<number, string>;
    katalogGeladen: boolean;
  }
  let { kontext, kategorien, katalogGeladen }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);
  const listen = $derived(einkaufListen(ansicht, kategorien));
  const reihe = $derived(einkaufsReihenfolge(ansicht.einkaeufe));

  let anlegen = $state(false);
</script>

<section aria-labelledby="einkaeufe-heading" class="space-y-3">
  <h3 id="einkaeufe-heading" class="font-serif text-lg font-bold text-brand-900">Einkäufe</h3>
  {#if reihe.length}
    <ul class="space-y-3" aria-label="Einkäufe">
      {#each reihe as einkauf (einkauf.id)}
        {@const liste = listen.get(einkauf.id)}
        {#if liste}
          <EinkaufKarte {kontext} {liste} {bearbeiten} {katalogGeladen} />
        {/if}
      {/each}
    </ul>
  {:else}
    <p class="text-neutral-700">Noch keine Einkäufe.</p>
  {/if}
  {#if bearbeiten}
    {#if anlegen}
      <EinkaufForm {kontext} einkauf={null} onfertig={() => (anlegen = false)} />
    {:else}
      <ActionButton type="button" onclick={() => (anlegen = true)}>Einkauf anlegen</ActionButton>
    {/if}
  {/if}
</section>
