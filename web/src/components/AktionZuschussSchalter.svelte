<script lang="ts">
  import { errorMessage } from '../lib/api';
  import { saveZuschussfaehig } from '../lib/aktionZuschuss';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import InfoHint from './ui/InfoHint.svelte';

  interface Props {
    /** CampFlow ID of the Aktion. */
    eventId: string;
    title: string;
    zuschussfaehig: boolean;
    /** Events that are no real Aktion never get the grant; the switch is not needed then. */
    keineAktion?: boolean;
    /** Links to the Aktion where the mark „Keine Aktion“ is set; off on that page itself. */
    aktionLink?: boolean;
    /** Says that the switch saves on its own; off when the page says it once for several. */
    savesNote?: boolean;
    class?: string;
  }

  let {
    eventId,
    title,
    zuschussfaehig,
    keineAktion = false,
    aktionLink = true,
    savesNote = true,
    class: className = '',
  }: Props = $props();

  let busy = $state(false);
  let result = $state<{ text: string; kind: 'success' | 'error' } | null>(null);
  const inputId = $derived(`kjr-zuschuss-${eventId}`);
  const hintId = $derived(`kjr-zuschuss-hinweis-${eventId}`);
  const hint = $derived(
    busy ? 'Wird gespeichert …' : zuschussfaehig ? 'Steht in den KJR-Fristen.' : 'Keine KJR-Frist.'
  );

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

{#if keineAktion}
  <p class="text-sm text-neutral-700 {className}" data-testid="kjr-zuschuss-schalter">
    <span class="font-semibold text-brand-900">Kein KJR-Zuschuss (keine Aktion).</span>
    {#if aktionLink}
      <a
        class="font-semibold text-link underline"
        href="/leitendenbereich/aktionen/aktion?id={encodeURIComponent(eventId)}">Zur Aktion</a
      >
    {/if}
  </p>
{:else}<div class={className} data-testid="kjr-zuschuss-schalter">
    <!-- The (i) is a button, so it sits next to the label instead of inside it -->
    <div class="flex items-start gap-3 py-1">
      <input
        id={inputId}
        type="checkbox"
        class="mt-3 size-5 shrink-0 accent-action"
        checked={zuschussfaehig}
        disabled={busy}
        aria-describedby={hintId}
        onchange={(event) => change(event.currentTarget)}
      />
      <div class="text-sm">
        <label
          for={inputId}
          class="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-900"
        >
          KJR-Zuschuss beantragen
        </label>
        <InfoHint label="KJR-Zuschuss" class="ml-1">
          <p>
            Mit Zuschuss steht die Aktion in den KJR-Fristen, und die Abrechnung rechnet den
            Zuschuss ein.
          </p>
          <p>
            Ohne Zuschuss zeigt die Abrechnung nur Einnahmen und Ausgaben, z. B. bei fremden
            Aktionen, für die wir nur die Anmeldungen sammeln.
          </p>
        </InfoHint>
        <span id={hintId} class="block text-neutral-700">
          {hint}
          {#if savesNote && !busy}Wird sofort gespeichert.{/if}
        </span>
      </div>
    </div>
    <StatusNotice class="mt-2" message={result?.text ?? null} kind={result?.kind} popup />
  </div>{/if}
