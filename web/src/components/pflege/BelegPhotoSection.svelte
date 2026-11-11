<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import BelegFotoEntwurf from './BelegFotoEntwurf.svelte';
  import BelegFotoPruefung from './BelegFotoPruefung.svelte';
  import BelegAiCheck from './BelegAiCheck.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import BelegPdfSeiten from './BelegPdfSeiten.svelte';
  import { ladePdf, photoUrl, formatTimestamp, type BelegForm } from '../../lib/belegForm';
  import { ladeGespeichertesFoto } from '../../lib/belegFotoNachbearbeiten';
  import { zuSpeichern } from '../../lib/belegEntwurf';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  interface Props {
    form: BelegForm;
    photo: ReturnType<typeof createBelegPhotoDraft>;
    busy: boolean;
    errors: Record<string, string>;
    /** Only to look at: the photo and its links, no tools. */
    lesen?: boolean;
  }
  let { form, photo, busy, errors, lesen = false }: Props = $props();
  /** A picture of the photo or of a page of the PDF, as wide as the dialog. */
  const SEITE = 'h-auto w-full rounded-md border border-neutral-200 bg-neutral-100';
  /** The stored photo is open with the edit tools, rather than a newly chosen one. */
  const nachbearbeitet = $derived(!!photo.draft?.aufbewahrt);
</script>

<section aria-labelledby="bl-photo-label" class="space-y-2">
  <p id="bl-photo-label" class="form-label inline">Foto oder PDF des Belegs</p>
  {#if !lesen}<InfoHint label="Foto oder PDF des Belegs" class="ml-1">
      <p>
        Am besten mit der Scan-Funktion des Handys: auf dem iPhone in der Notizen- oder Dateien-App
        „Dokumente scannen“, auf Android in Google Drive „Scannen“.
      </p>
      <p>
        Ein normales Foto geht auch: Beleg flach hinlegen, gut beleuchten, alle Ränder im Bild, am
        besten auf dunklem Untergrund.
      </p>
      <p>
        Rechnungen, die du als PDF bekommen hast, lädst du direkt als PDF hoch, mit allen Seiten
        (höchstens 5 MB).
      </p>
    </InfoHint>{/if}
  {#if form.id && form.hasImage && !photo.draft}
    <a href={photoUrl(form)} target="_blank" rel="noopener" class="block">
      <img
        src={photoUrl(form)}
        alt="{form.isPdf ? 'Erste Seite des PDFs' : 'Foto des Belegs'} von {form.shop}"
        width="600"
        height="800"
        class={SEITE}
      />
    </a>
    {#if form.isPdf}
      <BelegPdfSeiten
        schluessel={photoUrl(form)}
        laden={(signal) => ladePdf(form, signal)}
        class={SEITE}
      />
    {/if}
    <!-- Links that only open or save the file; the buttons below change it -->
    <div class="flex flex-wrap gap-x-5">
      <a href={photoUrl(form)} target="_blank" rel="noopener" class="datei-link"
        >In voller Größe öffnen</a
      >
      <a href="{photoUrl(form)}&download=1" download class="datei-link">
        {form.isPdf ? 'PDF herunterladen' : 'Foto herunterladen'}
      </a>
      {#if form.hasOriginal}
        <a href="{photoUrl(form)}&original=1" target="_blank" rel="noopener" class="datei-link">
          Original ansehen
        </a>
      {/if}
    </div>
  {/if}
  {#if lesen && !form.hasImage}
    <p class="text-sm text-neutral-700">Kein Foto oder PDF.</p>
  {/if}
  {#if !lesen}<BelegFotoEntwurf {photo} {busy} />{/if}
  <!-- While cropping, only the crop's own buttons are shown -->
  {#if !lesen && !photo.zuschnitt}
    <div class="flex flex-wrap items-center gap-2">
      {#if photo.draft && form.id}
        <ActionButton
          variant="primary"
          type="button"
          disabled={photo.photoBusy || busy || !zuSpeichern(photo.draft)}
          onclick={photo.savePhoto}
          >{photo.draft.pdf
            ? 'Neues PDF speichern'
            : nachbearbeitet
              ? 'Bearbeitetes Foto speichern'
              : 'Neues Foto speichern'}</ActionButton
        >
        <ActionButton
          variant="secondary"
          type="button"
          disabled={photo.photoBusy || busy}
          onclick={photo.clearDraft}>Verwerfen</ActionButton
        >
      {/if}
      {#if form.id && form.hasImage && !form.isPdf && !photo.draft}
        <ActionButton
          variant="secondary"
          type="button"
          disabled={photo.photoBusy || busy}
          onclick={() => photo.nachbearbeiten(() => ladeGespeichertesFoto(form))}
          >Foto bearbeiten</ActionButton
        >
      {/if}
      <!-- Choosing the first file is the main step; replacing it is a quiet link -->
      <label
        class="photo-picker relative cursor-pointer {form.hasImage || photo.draft
          ? 'datei-link ml-auto'
          : 'btn-secondary'}"
        class:opacity-60={photo.photoBusy}
      >
        {photo.photoBusy
          ? 'Wird verarbeitet …'
          : form.hasImage || photo.draft
            ? 'Anderes Foto oder PDF wählen'
            : 'Foto aufnehmen oder Datei wählen'}
        <input
          type="file"
          accept="image/*,application/pdf"
          class="sr-only"
          aria-invalid={errors.photo ? 'true' : undefined}
          aria-describedby={errors.photo ? 'bl-photo-error' : undefined}
          disabled={photo.photoBusy || busy}
          onchange={photo.choosePhoto}
        />
      </label>
    </div>
  {/if}
  <BelegAiCheck isNew={!form.id} check={form.aiCheck} warnings={photo.photoWarnings} />
  <BelegFotoPruefung {photo} />
  {#if errors.photo}
    <p id="bl-photo-error" class="text-sm text-danger">{errors.photo}</p>
  {/if}
  {#if form.id && !lesen}
    <p class="text-xs text-neutral-700">
      Eingereicht{form.submittedBy ? ` von ${form.submittedBy}` : ''}{form.submittedAt
        ? ` am ${formatTimestamp(form.submittedAt)}`
        : ''}.
    </p>
  {/if}
</section>

<style>
  .datei-link {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-link);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .photo-picker:focus-within {
    outline: 3px solid var(--color-focus);
    outline-offset: 3px;
  }
</style>
