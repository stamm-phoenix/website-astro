<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import BelegScanEditor from './BelegScanEditor.svelte';
  import BelegAiCheck from './BelegAiCheck.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { photoUrl, formatTimestamp, type BelegForm } from '../../lib/belegForm';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import type { Ausrichtung, FotoFarben } from '../../lib/belegBild';
  interface Props {
    form: BelegForm;
    photo: ReturnType<typeof createBelegPhotoDraft>;
    busy: boolean;
    errors: Record<string, string>;
  }
  let { form, photo, busy, errors }: Props = $props();
  const FARBEN: { value: FotoFarben; label: string }[] = [
    { value: 'farbe', label: 'Farbe' },
    { value: 'graustufen', label: 'Graustufen' },
    { value: 'original', label: 'Original' },
  ];
  type Werkzeug = 'zuschneiden' | Ausrichtung | 'zuruecksetzen';
  /** The tools; icons from simple strokes, the label is also the tooltip. */
  const TOOLS: { id: Werkzeug; label: string; text?: string; icon: string }[] = [
    {
      id: 'zuschneiden',
      label: 'Zuschneiden',
      text: 'Zuschneiden',
      icon: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
    },
    { id: 'links', label: 'Nach links drehen', icon: 'M3 4v6h6M3.5 13a9 9 0 1 0 2.1-8.4L3 7' },
    {
      id: 'rechts',
      label: 'Nach rechts drehen',
      icon: 'M21 4v6h-6M20.5 13a9 9 0 1 1-2.1-8.4L21 7',
    },
    {
      id: 'horizontal',
      label: 'Horizontal spiegeln',
      icon: 'M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z',
    },
    {
      id: 'vertikal',
      label: 'Vertikal spiegeln',
      icon: 'M3 12h18M7 8l5-5 5 5H7zM7 16l5 5 5-5H7z',
    },
    {
      id: 'zuruecksetzen',
      label: 'Auf das Originalfoto zurücksetzen',
      text: 'Zurücksetzen',
      icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    },
  ];

  function runTool(id: Werkzeug): void {
    if (id === 'zuschneiden') void photo.zuschneiden();
    else if (id === 'zuruecksetzen') photo.zuruecksetzen();
    else photo.ausrichten(id);
  }
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
    {@const draft = photo.draft}
    {@const locked = photo.photoBusy || busy}
    {#if photo.zuschnitt}
      <BelegScanEditor
        src={photo.zuschnitt.url}
        width={photo.zuschnitt.width}
        height={photo.zuschnitt.height}
        quad={photo.zuschnitt.quad}
        disabled={locked}
        onchange={photo.setZuschnitt}
      />
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          type="button"
          disabled={locked}
          onclick={photo.zuschnittFertig}>Zuschneiden fertig</ActionButton
        >
        <ActionButton
          variant="secondary"
          type="button"
          disabled={locked}
          onclick={photo.zuschnittAbbrechen}>Abbrechen</ActionButton
        >
      </div>
    {:else}
      {#if draft.result}
        <img
          src={draft.result.url}
          alt="Vorschau des Fotos"
          width={draft.result.width}
          height={draft.result.height}
          class="h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-surface"
        />
      {:else}
        <div
          role="status"
          class="flex h-48 w-36 items-center justify-center rounded-md border border-neutral-200 bg-neutral-100 text-sm text-neutral-700"
        >
          Wird verarbeitet …
        </div>
      {/if}
      <div role="toolbar" aria-label="Foto bearbeiten" class="flex flex-wrap items-center gap-1">
        {#each TOOLS as tool (tool.label)}
          <button
            type="button"
            class="werkzeug"
            title={tool.label}
            aria-label={tool.label}
            disabled={locked || (tool.id === 'zuruecksetzen' && !photo.edited)}
            onclick={() => runTool(tool.id)}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"><path d={tool.icon} /></svg
            >
            {#if tool.text}<span>{tool.text}</span>{/if}
          </button>
        {/each}
      </div>
      <FilterTabs
        label="Farben"
        showLabel
        variant="segmented"
        options={FARBEN}
        value={draft.mode}
        disabled={locked}
        onselect={photo.setMode}
      />
    {/if}
    {#if photo.scanHint}
      <p class="text-xs text-neutral-700">{photo.scanHint}</p>
    {/if}
    {#if form.id}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          type="button"
          disabled={photo.photoBusy || busy || !photo.draft.result || !!photo.zuschnitt}
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
  .werkzeug {
    display: inline-flex;
    min-height: 2.75rem;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: 1px solid var(--color-neutral-200);
    border-radius: var(--radius-md, 0.375rem);
    padding: 0 0.625rem;
    color: var(--color-brand-900);
    font-size: 0.875rem;
    font-weight: 600;
    background: var(--color-surface, transparent);
  }

  .werkzeug:hover:not(:disabled) {
    border-color: var(--color-brand-300);
  }

  .werkzeug:focus-visible {
    outline: 2px solid var(--color-action);
    outline-offset: 2px;
  }

  .werkzeug:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

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
