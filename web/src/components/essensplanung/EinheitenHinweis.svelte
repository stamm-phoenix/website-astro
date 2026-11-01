<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EinheitenDialog from './EinheitenDialog.svelte';
  import { uneinheitlicheZutaten } from '../../../../api/lib/essen-einheiten-model';
  import { einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanKontext } from './planKontext';

  /**
   * Ingredients whose amounts stand in more than one unit (Bund and g): each offers to bring them
   * into one unit, which the shopping list then sums up.
   */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  const zutaten = $derived(
    [...uneinheitlicheZutaten(ansicht)].flatMap(([id, einheiten]) => {
      const zutat = ansicht.zutaten.find((z) => z.id === id);
      return zutat ? [{ zutat, einheiten: einheiten.map((e) => einheitText(e)).join(', ') }] : [];
    })
  );
  let offen = $state<number | null>(null);
  const gewaehlt = $derived(zutaten.find((eintrag) => eintrag.zutat.id === offen)?.zutat);
</script>

{#if zutaten.length}
  <section
    class="surface-muted flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm print:hidden"
    aria-labelledby="einheiten-hinweis"
  >
    <h2 id="einheiten-hinweis" class="font-semibold text-neutral-900">In mehreren Einheiten:</h2>
    <ul class="flex flex-wrap gap-2">
      {#each zutaten as { zutat, einheiten } (zutat.id)}
        <li>
          <ActionButton
            type="button"
            class="!px-2 !py-0.5 text-sm any-pointer-coarse:min-h-11"
            aria-label="{zutat.name} steht in {einheiten}: vereinheitlichen"
            onclick={() => (offen = zutat.id)}
            >{zutat.name} <span class="text-neutral-700">({einheiten})</span> · vereinheitlichen</ActionButton
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}
{#if gewaehlt}
  <EinheitenDialog {kontext} zutat={gewaehlt} onclose={() => (offen = null)} />
{/if}
