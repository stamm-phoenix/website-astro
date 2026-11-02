<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import BelegFotoEntwurf from './BelegFotoEntwurf.svelte';
  import BelegFotoPruefung from './BelegFotoPruefung.svelte';
  import BelegAiCheck from './BelegAiCheck.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { photoUrl, formatTimestamp, type BelegForm } from '../../lib/belegForm';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  interface Props {
    form: BelegForm;
    photo: ReturnType<typeof createBelegPhotoDraft>;
    busy: boolean;
    errors: Record<string, string>;
  }
  let { form, photo, busy, errors }: Props = $props();
</script>

<section aria-labelledby="bl-photo-label" class="space-y-2">
  <p id="bl-photo-label" class="form-label inline">Foto oder PDF des Belegs</p>
  <InfoHint label="Foto oder PDF des Belegs" class="ml-1">
    <p>
      Am besten mit der Scan-Funktion des Handys: auf dem iPhone in der Notizen- oder Dateien-App
      „Dokumente scannen“, auf Android in Google Drive „Scannen“.
    </p>
    <p>
      Ein normales Foto geht auch: Beleg flach hinlegen, gut beleuchten, alle Ränder im Bild, am
      besten auf dunklem Untergrund.
    </p>
    <p>Rechnungen, die du als PDF bekommen hast, lädst du direkt als PDF hoch (höchstens 5 MB).</p>
  </InfoHint>
  {#if form.id && form.hasImage && !photo.draft}
    <a href={photoUrl(form)} target="_blank" rel="noopener" class="block">
      <img
        src={photoUrl(form)}
        alt="{form.isPdf ? 'Erste Seite des PDFs' : 'Foto des Belegs'} von {form.shop}"
        width="600"
        height="800"
        class="max-h-96 w-auto rounded-md border border-neutral-200 bg-neutral-100 object-contain"
      />
      <span class="mt-1 block text-xs text-link underline">In voller Größe öffnen</span>
    </a>
  {/if}
  <BelegFotoEntwurf {photo} {busy} />
  {#if photo.draft}
    {#if form.id}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          type="button"
          disabled={photo.photoBusy || busy || !photo.draft.result || !!photo.zuschnitt}
          onclick={photo.savePhoto}
          >{photo.draft.pdf ? 'Neues PDF speichern' : 'Neues Foto speichern'}</ActionButton
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
          ? 'Anderes Foto oder PDF wählen'
          : 'Foto aufnehmen oder Datei wählen'}
      <input
        type="file"
        accept="image/*,application/pdf"
        class="sr-only"
        aria-describedby={errors.photo ? 'bl-photo-error' : undefined}
        disabled={photo.photoBusy || busy}
        onchange={photo.choosePhoto}
      />
    </label>
    {#if form.id && form.hasImage && !photo.draft}
      <a class="btn-secondary" href="{photoUrl(form)}&download=1" download>
        {form.isPdf ? 'PDF herunterladen' : 'Foto herunterladen'}
      </a>
      {#if form.hasOriginal}
        <a class="btn-secondary" href="{photoUrl(form)}&original=1" target="_blank" rel="noopener">
          Original ansehen
        </a>
      {/if}
    {/if}
  </div>
  <BelegAiCheck isNew={!form.id} check={form.aiCheck} warnings={photo.photoWarnings} />
  <BelegFotoPruefung {photo} />
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
