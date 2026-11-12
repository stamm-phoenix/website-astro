<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import RezeptImportDialog from './RezeptImportDialog.svelte';
  import type { EssenKatalog, Gericht } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * „Gericht generieren lassen (KI)“ at the top of a dish: the AI writes the whole dish from a
   * description (people, ingredients, instructions, tools), shown to confirm before anything is
   * saved (`RezeptImportDialog.svelte`).
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    /** False during maintenance: an open dialog stays, its actions wait. */
    bearbeiten: boolean;
  }
  let { kontext, katalog, gericht, bearbeiten }: Props = $props();
  let offen = $state(false);
</script>

<ActionButton
  type="button"
  disabled={!bearbeiten || !katalog}
  aria-label="Gericht generieren lassen (KI): {gericht.name}"
  onclick={() => (offen = true)}>Gericht generieren lassen (KI)</ActionButton
>

{#if katalog && offen}
  <RezeptImportDialog
    {kontext}
    {katalog}
    {gericht}
    {bearbeiten}
    art="generieren"
    open={offen}
    onclose={() => (offen = false)}
  />
{/if}
