<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import type { Geschaeft } from '../../lib/types';
  import { KNOPF } from './einkaufHerkunft.svelte';
  import type { PlanKontext } from './planKontext';

  /** The shops of a Planung, to add, rename and delete. */

  interface Props {
    kontext: PlanKontext;
    /** Opens the dialog of a shop; null adds one. */
    onbearbeiten: (id: number | null) => void;
  }
  let { kontext, onbearbeiten }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  async function loeschen(geschaeft: Geschaeft): Promise<void> {
    const { id, etag, name } = geschaeft;
    if (
      !(await confirmAction({
        title: `${name} löschen?`,
        message: 'Die Zutaten dieses Geschäfts stehen danach unter „Ohne Geschäft“.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/geschaefte/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
  }
</script>

<section aria-labelledby="geschaefte-heading" class="space-y-1 print:hidden">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="geschaefte-heading" class="font-serif text-lg font-bold text-brand-900">Geschäfte</h3>
    {#if bearbeiten}
      <ActionButton type="button" class={KNOPF} onclick={() => onbearbeiten(null)}
        >Geschäft hinzufügen</ActionButton
      >
    {/if}
  </div>
  {#if ansicht.geschaefte.length}
    <ul
      class="divide-y divide-neutral-200 border-y border-neutral-300 text-sm"
      aria-label="Geschäfte"
    >
      {#each ansicht.geschaefte as geschaeft (geschaeft.id)}
        <li class="flex items-center gap-2 py-0.5">
          <span class="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{geschaeft.name}</span
          >
          {#if bearbeiten}
            <span class="flex shrink-0 gap-1">
              <ActionButton
                type="button"
                class={KNOPF}
                aria-label="Geschäft {geschaeft.name} ändern"
                onclick={() => onbearbeiten(geschaeft.id)}>Ändern</ActionButton
              >
              <ActionButton
                type="button"
                variant="danger"
                class={KNOPF}
                disabled={kontext.busy}
                aria-label="Geschäft {geschaeft.name} löschen"
                onclick={() => void loeschen(geschaeft)}>Löschen</ActionButton
              >
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-neutral-700">Noch keine Geschäfte.</p>
  {/if}
</section>
