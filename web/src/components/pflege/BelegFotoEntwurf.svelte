<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import BelegScanEditor from './BelegScanEditor.svelte';
  import type { createBelegPhotoDraft } from '../../lib/belegPhotoDraft.svelte';
  import type { Ausrichtung, FotoFarben } from '../../lib/belegBild';

  /**
   * The chosen photo of a receipt while it is edited: crop, turn, mirror and colours. Shared by
   * the Belege of the Leitendenbereich and of the Essensplanung.
   */

  interface Props {
    photo: ReturnType<typeof createBelegPhotoDraft>;
    busy: boolean;
  }
  let { photo, busy }: Props = $props();
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
      // A picture with a mountain: back to the photo as taken
      icon: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
    },
  ];

  function runTool(id: Werkzeug): void {
    if (id === 'zuschneiden') void photo.zuschneiden();
    else if (id === 'zuruecksetzen') photo.zuruecksetzen();
    else photo.ausrichten(id);
  }
</script>

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
        alt={draft.pdf ? 'Erste Seite des PDFs' : 'Vorschau des Fotos'}
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
    {#if !draft.pdf}
      <div role="toolbar" aria-label="Foto bearbeiten" class="flex flex-wrap items-center gap-1">
        {#each TOOLS as tool (tool.label)}
          <button
            type="button"
            class="werkzeug"
            class:ml-auto={tool.id === 'zuruecksetzen'}
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
  {/if}
  {#if photo.scanHint}
    <p class="text-xs text-neutral-700">{photo.scanHint}</p>
  {/if}
{/if}

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
</style>
