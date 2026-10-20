<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { rescuedLabel, type GeretteterWert } from '../../lib/geretteteEingaben';

  /**
   * Input from before a new login in the iPhone app that the dialog could not fill in itself,
   * e.g. a row the form does not have yet; shown inside the dialog, so it can be copied over.
   */
  interface Props {
    values: GeretteterWert[];
  }
  let { values }: Props = $props();

  let copied = $state<number | null>(null);
  let failed = $state<number | null>(null);

  async function copy(index: number, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copied = index;
      failed = null;
    } catch {
      failed = index;
      copied = null;
    }
  }
</script>

<section aria-labelledby="nicht-eingesetzt" class="surface-muted mb-3 space-y-2 p-3 text-sm">
  <h3 id="nicht-eingesetzt" class="font-semibold text-neutral-800">Noch nicht eingesetzt</h3>
  <p class="text-neutral-700">
    Für diese Eingaben fehlt im Formular noch das Feld, zum Beispiel eine weitere Zeile. Leg es an,
    dann setzt das Formular den Wert selbst ein. Sie bleiben gesichert, bis alles eingesetzt ist.
  </p>
  <ul class="space-y-2">
    {#each values as kept, index (kept.key)}
      <li class="border-t border-neutral-200 pt-2">
        <p class="font-semibold text-neutral-800">{rescuedLabel(kept)}</p>
        {#if kept.kind === 'checked'}
          <p class="text-neutral-800">angehakt</p>
        {:else}
          <p class="whitespace-pre-wrap text-neutral-800">{kept.value}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <ActionButton onclick={() => copy(index, kept.value)}>
              {rescuedLabel(kept)} kopieren
            </ActionButton>
            <span role="status">
              {#if copied === index}<span class="text-success">Kopiert.</span>
              {:else if failed === index}<span class="text-danger"
                  >Kopieren ging nicht, bitte von Hand abschreiben.</span
                >{/if}
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>
