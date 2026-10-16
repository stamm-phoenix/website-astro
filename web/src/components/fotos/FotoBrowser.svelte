<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import FotoDetail from './FotoDetail.svelte';
  import FotoPfad from './FotoPfad.svelte';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import {
    cancelFotoDownload,
    downloadFotosAsZip,
    fotoDownload,
    saveFotoFile,
    zipLimitMessage,
  } from '../../lib/fotoDownload.svelte';
  import { folderEntry, isFresh, loadFotoFolder } from '../../lib/fotoOrdnerStore.svelte';
  import type { FotoFile } from '../../lib/types';

  interface Props {
    path: string;
    /** File open in the detail view. */
    foto: string | null;
    onnavigate: (path: string) => void;
    onopen: (id: string | null) => void;
    /** Upload into this folder. */
    onupload: (path: string) => void;
  }
  let { path, foto, onnavigate, onopen, onupload }: Props = $props();

  const entry = $derived(folderEntry(path));
  const data = $derived(entry.data);
  const files = $derived(data?.files ?? []);
  const openIndex = $derived(foto ? files.findIndex((file) => file.id === foto) : -1);

  let selecting = $state(false);
  const selected = new SvelteSet<string>();
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  /** Preview links that failed to load, e.g. expired; a new link of the same file is tried. */
  const brokenPreviews = new SvelteSet<string>();

  const selectedFiles = $derived(files.filter((file) => selected.has(file.id)));
  const selectedBytes = $derived(selectedFiles.reduce((sum, file) => sum + file.size, 0));
  const summary = $derived.by(() => {
    const photos = files.filter((file) => file.kind === 'photo').length;
    const videos = files.filter((file) => file.kind === 'video').length;
    const others = files.length - photos - videos;
    return [
      photos ? `${photos} ${photos === 1 ? 'Foto' : 'Fotos'}` : '',
      videos ? `${videos} ${videos === 1 ? 'Video' : 'Videos'}` : '',
      others ? `${others} ${others === 1 ? 'andere Datei' : 'andere Dateien'}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  });

  $effect(() => {
    const current = path;
    untrack(() => {
      selecting = false;
      selected.clear();
      brokenPreviews.clear();
      message = null;
      void loadFotoFolder(current);
    });
  });

  function toggle(file: FotoFile): void {
    if (selected.has(file.id)) selected.delete(file.id);
    else selected.add(file.id);
  }

  function stopSelecting(): void {
    selecting = false;
    selected.clear();
  }

  async function downloadSelected(): Promise<void> {
    message = null;
    // A single file is saved directly, without an archive in memory
    const limit = selectedFiles.length > 1 ? zipLimitMessage(selectedBytes) : null;
    if (limit) {
      messageKind = 'error';
      message = limit;
      return;
    }
    // The download links expire after about an hour
    const wanted = selectedFiles;
    if (!isFresh(path)) await loadFotoFolder(path, { force: true });
    const fresh = (folderEntry(path).data?.files ?? []).filter((file) => selected.has(file.id));
    if (fresh.length === 0) {
      messageKind = 'error';
      message =
        'Die ausgewählten Dateien gibt es nicht mehr oder der Ordner konnte nicht neu geladen werden. Lade den Ordner neu.';
      return;
    }
    const missing = wanted.filter((file) => !fresh.some((other) => other.id === file.id));
    if (missing.length) {
      // Never a smaller download than asked for without saying so
      for (const file of missing) selected.delete(file.id);
      messageKind = 'error';
      message = `${missing.map((file) => `„${file.name}“`).join(', ')} gibt es nicht mehr, vielleicht in SharePoint gelöscht oder verschoben. Die Auswahl ist angepasst; tippe noch einmal auf „Herunterladen“.`;
      return;
    }
    if (fresh.length === 1 && fresh[0].downloadUrl) {
      messageKind = 'success';
      message = `„${fresh[0].name}“ wird heruntergeladen …`;
      await saveFotoFile(fresh[0].downloadUrl, fresh[0].name, fresh[0].size);
      message = `Download von „${fresh[0].name}“ gestartet. Du findest die Datei bei deinen Downloads.`;
      return;
    }
    await downloadFotosAsZip(fresh, data?.name || 'Fotos');
    messageKind = fotoDownload.phase === 'error' ? 'error' : 'success';
    message = fotoDownload.message;
    if (fotoDownload.phase === 'done') stopSelecting();
  }

  function duration(ms: number | null): string {
    if (!ms) return '';
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
</script>

<div class="space-y-3">
  <nav aria-label="Ordnerpfad" class="surface-muted px-3 py-1">
    <FotoPfad {path} onselect={onnavigate} large />
  </nav>

  <!-- Same height while loading, so nothing jumps when the link arrives -->
  <div class="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
    {#if path}
      <ActionButton onclick={() => onupload(path)}>Hierher hochladen</ActionButton>
    {/if}
    {#if data?.webUrl}
      <a
        class="inline-flex min-h-11 items-center gap-1 text-sm text-[var(--color-link)] underline underline-offset-2"
        href={data.webUrl}
        target="_blank"
        rel="noopener"
        >In SharePoint öffnen<span aria-hidden="true">↗</span><span class="sr-only">
          (öffnet neuen Tab)</span
        ></a
      >
    {:else}
      <span class="inline-flex min-h-11 items-center text-sm text-neutral-700" aria-hidden="true"
        >In SharePoint öffnen</span
      >
    {/if}
  </div>

  <LoadState
    {data}
    loading={entry.loading}
    error={entry.error}
    loadingText="Ordner wird geladen …"
    onretry={() => void loadFotoFolder(path, { force: true })}
    isEmpty={(content) => content.folders.length === 0 && content.files.length === 0}
  >
    {#snippet empty()}
      <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
        Dieser Ordner ist leer. Über „Hierher hochladen“ oder den Reiter „Hochladen“ kannst du
        welche hinzufügen.
      </p>
    {/snippet}
    {#snippet children(content)}
      {#if content.folders.length > 0}
        <section aria-labelledby="foto-ordner-heading">
          <h2
            id="foto-ordner-heading"
            class="mb-2 font-sans text-base font-semibold text-brand-900"
          >
            Ordner
          </h2>
          <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each content.folders as folder (folder.path)}
              <li>
                <button
                  type="button"
                  class="surface flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:border-[var(--color-brand-500)]"
                  onclick={() => onnavigate(folder.path)}
                >
                  <svg
                    aria-hidden="true"
                    class="size-6 shrink-0 text-brand-700"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path
                      d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
                    /></svg
                  >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold text-brand-900">{folder.name}</span>
                    {#if folder.childCount !== null}
                      <span class="block text-xs text-neutral-700">
                        {folder.childCount === 1 ? '1 Eintrag' : `${folder.childCount} Einträge`}
                      </span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if content.files.length > 0}
        <section aria-labelledby="foto-dateien-heading" class="mt-4">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="foto-dateien-heading"
                class="font-sans text-base font-semibold text-brand-900"
              >
                Fotos und Videos
              </h2>
              <p class="text-sm text-neutral-700">{summary}</p>
            </div>
            {#if selecting}
              <ActionButton onclick={stopSelecting}>Fertig</ActionButton>
            {:else}
              <ActionButton onclick={() => (selecting = true)}>Auswählen</ActionButton>
            {/if}
          </div>
          {#if selecting}
            <p class="mb-2 text-sm text-neutral-700">
              Tippe auf die Fotos, die du herunterladen möchtest.
            </p>
          {/if}
          <ul class="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {#each content.files as file, index (file.id)}
              {@const isSelected = selected.has(file.id)}
              <li>
                <button
                  type="button"
                  class="tile relative block aspect-square w-full overflow-hidden bg-[var(--color-neutral-200)]"
                  class:tile-selected={isSelected}
                  aria-label={selecting
                    ? `${file.name} auswählen`
                    : `${file.name}${file.kind === 'video' ? ', Video' : ''} groß anzeigen`}
                  aria-pressed={selecting ? isSelected : undefined}
                  data-index={index}
                  onclick={() => (selecting ? toggle(file) : onopen(file.id))}
                >
                  {#if file.thumbnailUrl && !brokenPreviews.has(file.thumbnailUrl)}
                    <img
                      src={file.thumbnailUrl}
                      alt=""
                      aria-hidden="true"
                      width="300"
                      height="300"
                      loading="lazy"
                      decoding="async"
                      class="h-full w-full object-cover"
                      onerror={() => file.thumbnailUrl && brokenPreviews.add(file.thumbnailUrl)}
                    />
                  {:else}
                    <span
                      class="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-neutral-700"
                    >
                      <svg
                        aria-hidden="true"
                        class="size-7"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path
                          d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"
                        /></svg
                      >
                      <span class="line-clamp-2 break-all">{file.name}</span>
                    </span>
                  {/if}
                  {#if file.kind === 'video'}
                    <span
                      class="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-xs text-white"
                    >
                      <svg aria-hidden="true" class="size-3" viewBox="0 0 24 24" fill="currentColor"
                        ><path d="M8 5v14l11-7z" /></svg
                      >
                      {duration(file.durationMs) || 'Video'}
                    </span>
                  {/if}
                  {#if selecting}
                    <span
                      aria-hidden="true"
                      class="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full border-2 border-white {isSelected
                        ? 'bg-[var(--color-action)]'
                        : 'bg-black/30'}"
                    >
                      {#if isSelected}
                        <svg
                          class="size-4 text-[var(--color-on-action)]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg
                        >
                      {/if}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/snippet}
  </LoadState>

  <StatusNotice {message} kind={messageKind} popup />

  {#if selecting}
    <div
      class="selection-bar surface sticky bottom-0 z-10 -mx-4 space-y-1 px-4 py-2 sm:mx-0"
      role="region"
      aria-label="Auswahl"
    >
      {#if fotoDownload.phase === 'running'}
        <p class="text-sm font-semibold text-brand-900" aria-live="polite">
          ZIP wird erstellt: {fotoDownload.doneFiles} von {fotoDownload.files} Dateien
        </p>
        <progress
          class="foto-progress h-2 w-full"
          max={fotoDownload.bytes || 1}
          value={fotoDownload.doneBytes}
          aria-label="Fortschritt des Downloads"
        ></progress>
        <ActionButton onclick={cancelFotoDownload}>Download abbrechen</ActionButton>
      {:else}
        <p class="text-sm font-semibold text-brand-900" aria-live="polite">
          {selected.size === 0
            ? 'Nichts ausgewählt'
            : `${selected.size} ausgewählt · ${formatFileSize(selectedBytes)}`}
        </p>
        <div class="flex flex-wrap gap-2">
          <ActionButton
            variant="primary"
            disabled={selected.size === 0}
            onclick={() => void downloadSelected()}
          >
            {selected.size > 1 ? 'Als ZIP herunterladen' : 'Herunterladen'}
          </ActionButton>
          {#if selected.size < files.length}
            <ActionButton onclick={() => files.forEach((file) => selected.add(file.id))}>
              Alle auswählen
            </ActionButton>
          {/if}
          {#if selected.size > 0}
            <button
              type="button"
              class="min-h-11 px-1 text-sm text-[var(--color-link)] underline underline-offset-2"
              onclick={() => selected.clear()}>Auswahl aufheben</button
            >
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if openIndex >= 0}
  <FotoDetail
    {files}
    index={openIndex}
    onindex={(next) => onopen(files[next].id)}
    onclose={() => onopen(null)}
  />
{/if}

<style>
  .tile:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  /* Frame in the action colour (blue, beige in the dark theme) and a darker photo */
  .tile-selected img {
    opacity: 0.6;
  }
  .tile-selected::after {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 4px var(--color-action);
    pointer-events: none;
  }
  .selection-bar {
    box-shadow: 0 -4px 12px rgb(0 0 0 / 0.08);
  }
  .foto-progress {
    appearance: none;
    overflow: hidden;
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .foto-progress::-webkit-progress-value {
    background: var(--color-success);
  }
  .foto-progress::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
