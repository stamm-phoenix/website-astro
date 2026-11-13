<script lang="ts">
  import { aktionZeitraum } from '../../lib/protokollEditor';
  import type { ProtokollPunkt } from '../../../../api/lib/protokoll-editor-model';

  /** The lines below the title of an agenda item as it reads: Aktion, date and project. */
  interface Props {
    punkt: Pick<ProtokollPunkt, 'aktion' | 'zeitraum' | 'projekt'>;
  }
  let { punkt }: Props = $props();

  const aktion = $derived(punkt.aktion ? aktionZeitraum(punkt.aktion) : '');
  const datum = $derived(punkt.zeitraum ? aktionZeitraum(punkt.zeitraum) : '');
</script>

{#if punkt.aktion}
  <p class="text-sm text-neutral-700">Aktion{aktion ? `, ${aktion}` : ''}</p>
{/if}
{#if datum}
  <p class="text-sm text-neutral-700">Datum: {datum}</p>
{/if}
{#if punkt.projekt}
  <p class="text-sm text-neutral-700">Projekt: {punkt.projekt.titel}</p>
{/if}
