<script lang="ts">
  import ProtokollPunktProjekt from './ProtokollPunktProjekt.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { aktionZeitraum, punktNummer } from '../../lib/protokollEditor';
  import { protokollAufgaben } from '../../lib/protokollAufgabenStore.svelte';
  import type { ProtokollPunkt } from '../../../../api/lib/protokoll-editor-model';

  /**
   * What the Markdown document (#613) cannot show of the item at the cursor: its Aktion, its
   * project and the open tasks to tick off, with the same controls as the other views.
   */
  interface Props {
    punkt: ProtokollPunkt;
    index: number;
    subIndex?: number;
  }
  let { punkt = $bindable(), index, subIndex }: Props = $props();

  const nummer = $derived(punktNummer(index, subIndex));
  const isSub = $derived(subIndex !== undefined);
  let choosing = $state(false);
  const canLink = $derived(
    !punkt.projekt &&
      !punkt.aktion &&
      !choosing &&
      (protokollAufgaben.state.data?.projekte.length ?? 0) > 0
  );
  const sichtbar = $derived(
    Boolean(punkt.aktion || punkt.projekt || punkt.offeneAufgaben.length > 0 || canLink || choosing)
  );
  const zeitraum = $derived(punkt.aktion ? aktionZeitraum(punkt.aktion) : '');
</script>

{#if sichtbar}
  <section
    class="space-y-2 border-l-2 border-neutral-400 pl-3"
    aria-label="Punkt {nummer} {punkt.titel.trim() || 'ohne Titel'}"
  >
    <p class="text-sm font-semibold text-brand-900">
      {nummer}
      {punkt.titel.trim() || 'Ohne Titel'}
    </p>
    {#if punkt.aktion}
      <p class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
        <span>Aktion „{punkt.aktion.titel}“{zeitraum ? `, ${zeitraum}` : ''}</span>
        <button
          type="button"
          class="text-link text-sm"
          onclick={() => (punkt.aktion = null)}
          aria-label="Verknüpfung mit der Aktion {punkt.aktion.titel} lösen"
          >Verknüpfung lösen</button
        >
      </p>
    {/if}
    {#if canLink}
      <ActionButton onclick={() => (choosing = true)}>Projekt verknüpfen</ActionButton>
    {/if}
    <ProtokollPunktProjekt
      bind:projekt={punkt.projekt}
      bind:offeneAufgaben={punkt.offeneAufgaben}
      bind:choosing
      aktion={punkt.aktion}
      {nummer}
      {isSub}
    />
  </section>
{/if}
