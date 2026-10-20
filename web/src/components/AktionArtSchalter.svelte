<script lang="ts">
  import { errorMessage } from '../lib/api';
  import { keineAktionHinweis } from '../lib/aktionArt';
  import { saveKeineAktion } from '../lib/aktionZuschuss';
  import type { CampflowEvent } from '../lib/types';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import InfoHint from './ui/InfoHint.svelte';

  interface Props {
    event: Pick<CampflowEvent, 'id' | 'title' | 'start_date' | 'end_date' | 'keineAktion'>;
    class?: string;
  }

  let { event, class: className = '' }: Props = $props();

  let busy = $state(false);
  let result = $state<{ text: string; kind: 'success' | 'error' } | null>(null);
  const inputId = $derived(`keine-aktion-${event.id}`);
  const hintId = $derived(`keine-aktion-hinweis-${event.id}`);
  const vorschlag = $derived(keineAktionHinweis(event));
  /** The state line under the label; an unmarked Aktion needs none. */
  const hint = $derived(
    busy ? 'Wird gespeichert …' : event.keineAktion ? 'Nicht im Kalender, kein KJR-Zuschuss.' : null
  );

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
  <!-- The (i) is a button, so it sits next to the label instead of inside it -->
  <div class="flex items-start gap-3 py-1">
    <input
      id={inputId}
      type="checkbox"
      class="mt-3 size-5 shrink-0 accent-action"
      checked={event.keineAktion}
      disabled={busy}
      aria-describedby={hint ? hintId : undefined}
      onchange={(input) => change(input.currentTarget)}
    />
    <div class="text-sm">
      <label
        for={inputId}
        class="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-900"
      >
        Keine Aktion, nur Bestellung oder Anmeldung
      </label>
      <InfoHint label="Keine Aktion" class="ml-1">
        <p>
          Für Einträge, die CampFlow nur für Anmeldung und Bezahlung nutzen, z. B. Bestellungen von
          Pullis oder Halstüchern.
        </p>
        <p>
          Sie stehen nicht im öffentlichen Kalender und nicht auf der Startseite und werden bei
          Fotos, Protokollen, Aufgaben und Fahrten nicht als Aktion angeboten. Kein KJR-Zuschuss; in
          der Abrechnung stehen sie unter „Bestellungen und Sonstiges“.
        </p>
      </InfoHint>
      {#if hint}
        <span id={hintId} class="block text-neutral-700">{hint}</span>
      {/if}
    </div>
  </div>
  {#if vorschlag && !busy}
    <p class="ml-8 text-sm text-warning" data-testid="keine-aktion-vorschlag">
      {vorschlag} Ist das vielleicht keine Aktion?
    </p>
  {/if}
  <StatusNotice class="mt-2" message={result?.text ?? null} kind={result?.kind} popup />
</div>
