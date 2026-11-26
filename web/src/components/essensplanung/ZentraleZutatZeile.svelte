<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { einheitKurz, ernaehrungLabel } from '../../lib/essensplanungSteuerung';
  import type { EssenZutat } from '../../../../api/lib/essen-validation';

  /** One ingredient of the central list with its properties and actions. */

  interface Props {
    zutat: EssenZutat;
    kategorie: string;
    /** The names of the allergens it contains. */
    allergene: string;
    busy: boolean;
    onbearbeiten: () => void;
    /** „Prüfen (KI)“; without it, the button is not shown. */
    onpruefen?: () => void;
  }
  let { zutat, kategorie, allergene, busy, onbearbeiten, onpruefen }: Props = $props();
</script>

<li data-focus-item class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
  <div class="min-w-0">
    <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">{zutat.name}</p>
    <p class="text-sm text-neutral-700">
      {kategorie} · {einheitKurz(zutat)}
      {#if zutat.lebensmittel}
        · {ernaehrungLabel(zutat)}
        {#if zutat.allergene.length}· enthält {allergene}{/if}
      {:else}
        · kein Lebensmittel
      {/if}
    </p>
    {#if zutat.hinweis}
      <p class="text-sm text-neutral-700 italic">{zutat.hinweis}</p>
    {/if}
  </div>
  <div class="flex shrink-0 gap-2 print:hidden">
    <ActionButton
      type="button"
      aria-label="Bearbeiten: {zutat.name}"
      disabled={busy}
      onclick={onbearbeiten}
    >
      Bearbeiten
    </ActionButton>
    {#if onpruefen}
      <ActionButton
        type="button"
        aria-label="{zutat.name} prüfen lassen (KI)"
        disabled={busy}
        onclick={onpruefen}
      >
        Prüfen (KI)
      </ActionButton>
    {/if}
  </div>
</li>
