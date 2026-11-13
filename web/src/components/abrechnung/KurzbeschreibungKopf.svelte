<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    einleitung: string;
    /** Something was entered, so „Zurücksetzen“ is offered. */
    zuruecksetzbar: boolean;
    pdfBusy: boolean;
    pdfError: string | null;
    oneinleitung: (value: string) => void;
    onreset: () => void;
    onpdf: () => void;
  }
  let { einleitung, zuruecksetzbar, pdfBusy, pdfError, oneinleitung, onreset, onpdf }: Props =
    $props();
</script>

<section aria-labelledby="kurzbeschreibung-titel" class="surface p-4 sm:p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex items-center gap-2">
      <h2 id="kurzbeschreibung-titel" class="font-serif text-lg font-semibold text-brand-900">
        Kurzbeschreibung für den KJR
      </h2>
      <InfoHint
        label="Kurzbeschreibung"
        text="Der KJR verlangt beim Antrag auf Zuschuss eine Kurzbeschreibung: wozu die Aktion dient und einen groben Zeitplan. Lade sie als PDF herunter und füge sie dem Antrag bei. Sie gehört zu deinen Eingaben und wird mit „Eingaben speichern“ gesichert."
      />
    </div>
    <div class="flex flex-wrap gap-2">
      {#if zuruecksetzbar}
        <ActionButton variant="secondary" onclick={onreset}>Zurücksetzen</ActionButton>
      {/if}
      <ActionButton variant="primary" disabled={pdfBusy} onclick={onpdf}>
        {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
      </ActionButton>
    </div>
  </div>
  <StatusNotice class="mt-3" kind="error" message={pdfError} />

  <label class="mt-4 block max-w-3xl">
    <span class="form-label">Zielsetzung</span>
    <textarea
      class="form-input min-h-24"
      rows="3"
      maxlength={2000}
      value={einleitung}
      oninput={(e) => oneinleitung(e.currentTarget.value)}
      placeholder="z. B. Mit der Aktion wollen wir die Gemeinschaft im Stamm stärken und ein bisschen Fantasie zurück in den Alltag bringen."
    ></textarea>
  </label>
</section>
