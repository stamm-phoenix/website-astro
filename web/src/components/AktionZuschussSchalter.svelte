<script lang="ts">
  import { errorMessage } from '../lib/api';
  import { saveZuschussfaehig } from '../lib/aktionZuschuss';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    /** CampFlow ID of the Aktion. */
    eventId: string;
    title: string;
    zuschussfaehig: boolean;
    class?: string;
  }

  let { eventId, title, zuschussfaehig, class: className = '' }: Props = $props();

  let busy = $state(false);
  let result = $state<{ text: string; kind: 'success' | 'error' } | null>(null);
  const hintId = $derived(`kjr-zuschuss-hinweis-${eventId}`);

  async function change(input: HTMLInputElement): Promise<void> {
    const value = input.checked;
    busy = true;
    result = null;
    try {
      await saveZuschussfaehig(eventId, value);
      result = {
        kind: 'success',
        text: value
          ? `Gespeichert: Für „${title}“ wird ein KJR-Zuschuss beantragt.`
          : `Gespeichert: Für „${title}“ wird kein KJR-Zuschuss beantragt.`,
      };
    } catch (error: unknown) {
      // Show the saved state again
      input.checked = !value;
      result = {
        kind: 'error',
        text: errorMessage(
          error,
          'Die Einstellung zum KJR-Zuschuss wurde nicht gespeichert. Prüfe deine Internetverbindung und tippe noch einmal auf das Kästchen.'
        ),
      };
    } finally {
      busy = false;
    }
  }
</script>

<div class={className} data-testid="kjr-zuschuss-schalter">
  <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
    <input
      type="checkbox"
      class="mt-0.5 size-5 shrink-0 accent-action"
      checked={zuschussfaehig}
      disabled={busy}
      aria-describedby={hintId}
      onchange={(event) => change(event.currentTarget)}
    />
    <span class="text-sm">
      <span class="font-semibold text-brand-900">KJR-Zuschuss beantragen</span>
      <span id={hintId} class="block text-neutral-700">
        {#if busy}
          Wird gespeichert …
        {:else if zuschussfaehig}
          Ja. Die Aktion steht in den KJR-Fristen, und die Abrechnung rechnet den Zuschuss ein.
        {:else}
          Nein. Keine KJR-Frist, und die Abrechnung zeigt nur Einnahmen und Ausgaben, z. B. bei
          fremden Aktionen, für die wir nur die Anmeldungen sammeln.
        {/if}
        Änderungen werden sofort gespeichert.
      </span>
    </span>
  </label>
  <StatusNotice class="mt-2" message={result?.text ?? null} kind={result?.kind} popup />
</div>
