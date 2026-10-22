<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import BelegScanEditor from './BelegScanEditor.svelte';
  import BelegAiCheck from './BelegAiCheck.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { photoUrl, formatTimestamp, type BelegForm } from '../../lib/belegForm';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import type { ScanMode } from '../../lib/belegScan';
  interface Props {
    form: BelegForm;
    photo: ReturnType<typeof createBelegPhotoDraft>;
    busy: boolean;
    errors: Record<string, string>;
  }
  let { form, photo, busy, errors }: Props = $props();
  const MODES: { id: ScanMode | 'aus'; label: string }[] = [
    { id: 'farbe', label: 'Farbe' },
    { id: 'graustufen', label: 'Graustufen' },
    { id: 'aus', label: 'Unverändert (ist schon ein Scan)' },
  ];
</script>

<section aria-labelledby="bl-photo-label" class="space-y-2">
  <p id="bl-photo-label" class="form-label inline">Foto des Belegs</p>
  <InfoHint label="Foto des Belegs" class="ml-1">
    <p>
      Am besten mit der Scan-Funktion des Handys: auf dem iPhone in der Notizen- oder Dateien-App
      „Dokumente scannen“, auf Android in Google Drive „Scannen“.
    </p>
    <p>
      Ein normales Foto geht auch: Beleg flach hinlegen, gut beleuchten, alle Ränder im Bild, am
      besten auf dunklem Untergrund.
    </p>
  </InfoHint>
  {#if form.id && form.hasImage && !photo.draft}
    <a href={photoUrl(form)} target="_blank" rel="noopener" class="block">
      <img
        src={photoUrl(form)}
        alt="Foto des Belegs von {form.shop}"
        width="600"
        height="800"
        class="max-h-96 w-auto rounded-md border border-neutral-200 bg-neutral-100 object-contain"
      />
      <span class="mt-1 block text-xs text-link underline">In voller Größe öffnen</span>
    </a>
  {/if}
  {#if photo.draft}
    <div class="grid gap-3 sm:grid-cols-2">
      <figure class="space-y-1">
        <figcaption class="text-xs font-semibold text-neutral-700">
          {photo.draft.mode === 'aus' ? 'Foto' : 'Original – Ecken auf den Beleg ziehen'}
        </figcaption>
        {#if photo.draft.mode === 'aus'}
          <img
            src={photo.draft.originalUrl}
            alt="Gewähltes Foto"
            width={photo.draft.original.width}
            height={photo.draft.original.height}
            class="h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-neutral-100"
          />
        {:else}
          <BelegScanEditor
            src={photo.draft.originalUrl}
            width={photo.draft.original.width}
            height={photo.draft.original.height}
            quad={photo.draft.quad}
            disabled={busy}
            onchange={photo.setQuad}
          />
        {/if}
      </figure>
      {#if photo.draft.result && photo.draft.mode !== 'aus'}
        <figure class="space-y-1">
          <figcaption class="text-xs font-semibold text-neutral-700">Scan</figcaption>
          <img
            src={photo.draft.result.url}
            alt="Vorschau des Scans"
            width={photo.draft.result.width}
            height={photo.draft.result.height}
            class="h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-surface"
          />
        </figure>
      {/if}
    </div>
    {#if photo.scanHint}
      <p class="text-xs text-neutral-700">{photo.scanHint}</p>
    {/if}
    <details class="mt-2">
      <summary class="min-h-11 cursor-pointer font-semibold text-link">Foto anpassen …</summary>
      <fieldset>
        <legend class="sr-only">Bearbeitung</legend>
        <div class="mt-1 space-y-1">
          {#each MODES as option (option.id)}
            <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                class="size-6 shrink-0 accent-[var(--color-action)]"
                name="bl-scan-mode"
                checked={photo.draft.mode === option.id}
                disabled={photo.photoBusy || busy}
                onchange={() => photo.setMode(option.id)}
              />
              {option.label}
            </label>
          {/each}
        </div>
      </fieldset>
    </details>
    {#if form.id}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          type="button"
          disabled={photo.photoBusy || busy || !photo.draft.result}
          onclick={photo.savePhoto}>Neues Foto speichern</ActionButton
        >
        <ActionButton
          variant="secondary"
          type="button"
          disabled={photo.photoBusy || busy}
          onclick={photo.clearDraft}>Verwerfen</ActionButton
        >
      </div>
    {/if}
  {/if}
  <div class="flex flex-wrap gap-2">
    <label class="btn-secondary cursor-pointer" class:opacity-60={photo.photoBusy}>
      {photo.photoBusy
        ? 'Wird verarbeitet …'
        : form.hasImage || photo.draft
          ? 'Anderes Foto wählen'
          : 'Foto aufnehmen oder wählen'}
      <input
        type="file"
        accept="image/*"
        class="sr-only"
        aria-describedby={errors.photo ? 'bl-photo-error' : undefined}
        disabled={photo.photoBusy || busy}
        onchange={photo.choosePhoto}
      />
    </label>
    {#if form.id && form.hasImage && !photo.draft}
      <a class="btn-secondary" href="{photoUrl(form)}&download=1" download> Foto herunterladen </a>
      {#if form.hasOriginal}
        <a class="btn-secondary" href="{photoUrl(form)}&original=1" target="_blank" rel="noopener">
          Original ansehen
        </a>
      {/if}
    {/if}
  </div>
  <BelegAiCheck isNew={!form.id} check={form.aiCheck} warnings={photo.photoWarnings} />
  {#if photo.aiChecking}
    <!-- The check takes about ten seconds; the bar fills in that time and waits near its end -->
    <div role="status" class="space-y-1.5" data-testid="beleg-pruefung">
      <p class="text-sm font-semibold text-brand-900">Beleg wird geprüft …</p>
      <div class="h-1.5 overflow-hidden rounded-full bg-neutral-200" aria-hidden="true">
        <div class="pruefung-fortschritt h-full rounded-full bg-[var(--color-action)]"></div>
      </div>
      <p class="text-sm text-neutral-700">Lesbarkeit, Vollständigkeit und Artikel</p>
    </div>
  {:else if photo.aiNotice}
    <p role="note" class="text-sm text-neutral-700"><MessageText text={photo.aiNotice} /></p>
  {/if}
  {#if errors.photo}
    <p id="bl-photo-error" class="text-sm text-danger">{errors.photo}</p>
  {/if}
  {#if form.id}
    <p class="text-xs text-neutral-700">
      Eingereicht{form.submittedBy ? ` von ${form.submittedBy}` : ''}{form.submittedAt
        ? ` am ${formatTimestamp(form.submittedAt)}`
        : ''}.
    </p>
  {/if}
</section>

<style>
  .pruefung-fortschritt {
    width: 90%;
    animation: pruefung-fuellen 12s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes pruefung-fuellen {
    from {
      width: 4%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pruefung-fortschritt {
      animation: none;
    }
  }
</style>
