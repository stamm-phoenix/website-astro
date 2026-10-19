<script lang="ts">
  import { errorMessage } from '../lib/api';
  import { keineAktionHinweis } from '../lib/aktionArt';
  import { saveKeineAktion } from '../lib/aktionZuschuss';
  import type { CampflowEvent } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';

  interface Props {
    event: Pick<CampflowEvent, 'id' | 'title' | 'start_date' | 'end_date' | 'keineAktion'>;
    class?: string;
  }

  let { event, class: className = '' }: Props = $props();

  let busy = $state(false);
  let result = $state<{ text: string; kind: 'success' | 'error' } | null>(null);
  const hintId = $derived(`keine-aktion-hinweis-${event.id}`);
  const vorschlag = $derived(keineAktionHinweis(event));

  async function change(input: HTMLInputElement): Promise<void> {
    const value = input.checked;
    busy = true;
    result = null;
    try {
      await saveKeineAktion(event.id, value);
      result = {
        kind: 'success',
        text: value
          ? `Gespeichert: „${event.title}“ ist keine Aktion, sondern nur eine Bestellung oder Anmeldung.`
          : `Gespeichert: „${event.title}“ ist wieder eine Aktion.`,
      };
    } catch (error: unknown) {
      // Show the saved state again
      input.checked = !value;
      result = {
        kind: 'error',
        text: errorMessage(
          error,
          'Die Einstellung „Keine Aktion“ wurde nicht gespeichert. Prüfe deine Internetverbindung und tippe noch einmal auf das Kästchen.'
        ),
      };
    } finally {
      busy = false;
    }
  }
</script>

<div class={className} data-testid="keine-aktion-schalter">
  <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
    <input
      type="checkbox"
      class="mt-0.5 size-5 shrink-0 accent-action"
      checked={event.keineAktion}
      disabled={busy}
      aria-describedby={hintId}
      onchange={(input) => change(input.currentTarget)}
    />
    <span class="text-sm">
      <span class="font-semibold text-brand-900">Keine Aktion, nur Bestellung oder Anmeldung</span>
      <span id={hintId} class="block text-neutral-700">
        {#if busy}
          Wird gespeichert …
        {:else if event.keineAktion}
          Ja. Es steht nicht im öffentlichen Kalender, nicht auf der Startseite und wird bei Fotos,
          Protokollen, Aufgaben und Fahrten nicht als Aktion angeboten. Kein KJR-Zuschuss; in der
          Abrechnung steht es unter „Bestellungen und Sonstiges“.
        {:else}
          Nein, das ist eine echte Aktion. Setze das Häkchen bei Einträgen, die CampFlow nur für
          Anmeldung und Bezahlung nutzen, z. B. Bestellungen von Pullis oder Halstüchern.
        {/if}
        Änderungen werden sofort gespeichert.
      </span>
    </span>
  </label>
  {#if vorschlag && !busy}
    <p class="ml-8 text-sm text-warning" data-testid="keine-aktion-vorschlag">
      {vorschlag} Ist das vielleicht keine Aktion?
    </p>
  {/if}
  <StatusNotice class="mt-2" message={result?.text ?? null} kind={result?.kind} popup />
</div>
