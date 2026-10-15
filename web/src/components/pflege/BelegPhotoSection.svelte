<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import BelegScanEditor from './BelegScanEditor.svelte';
  import BelegAiCheck from './BelegAiCheck.svelte';
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
  <p id="bl-photo-label" class="form-label">Foto des Belegs</p>
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
    <fieldset>
      <legend class="text-xs font-semibold text-neutral-700">Bearbeitung</legend>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {#each MODES as option (option.id)}
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="bl-scan-mode"
              checked={photo.draft.mode === option.id}
              disabled={photo.photoBusy || busy}
              onchange={() => photo.setMode(option.id)}
            />
            {option.label}
          </label>
        {/each}
      </div>
      {#if photo.draft.mode !== 'aus'}
        <p class="mt-1 text-xs text-neutral-700">
          Gespeichert werden der Scan und das Originalfoto.
        </p>
      {/if}
    </fieldset>
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
  {#if photo.photoWarnings.length > 0}
    <ul role="note" class="space-y-1 rounded-md bg-warning-soft p-3 text-xs text-warning">
      {#each photo.photoWarnings as warning (warning)}
        <li>{warning}</li>
      {/each}
      <li>Du kannst trotzdem einreichen, wenn alles gut lesbar ist.</li>
    </ul>
  {/if}
  {#if photo.aiChecking}
    <p role="status" class="text-xs text-neutral-700">KI-Vorprüfung läuft …</p>
  {:else if form.aiCheck}
    <BelegAiCheck isNew={!form.id} check={form.aiCheck} />
  {:else if photo.aiNotice}
    <p role="note" class="text-xs text-neutral-700"><MessageText text={photo.aiNotice} /></p>
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
