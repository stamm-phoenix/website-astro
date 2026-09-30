<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { downloadsPflege } from '../../lib/pflegeStore.svelte';
  import { formatFileSize, getDownloadPreviewUrl } from '../../lib/downloadsStore.svelte';
  import type { StaffDownload } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  /** Graph requires upload chunks to be a multiple of 320 KiB. */
  const CHUNK_SIZE = 10 * 320 * 1024;

  interface Upload {
    file: File;
    progress: number;
    status: 'uploading' | 'exists' | 'done' | 'error';
    error?: string;
  }

  const store = downloadsPflege.state;
  const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

  let uploads = $state<Upload[]>([]);
  let dragging = $state(false);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let renaming = $state<{ file: StaffDownload; name: string } | null>(null);
  let renameError = $state<string | null>(null);
  let busy = $state(false);
  let confirmDeleteId = $state<string | null>(null);

  const files = $derived(
    [...(store.data ?? [])].sort((a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt))
  );

  $effect(() => {
    untrack(() => downloadsPflege.load());
  });

  /** Sends one chunk with progress reporting (fetch has no upload progress). */
  function putChunk(
    url: string,
    chunk: Blob,
    start: number,
    total: number,
    onprogress: (loaded: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${start + chunk.size - 1}/${total}`);
      xhr.upload.onprogress = (event) => onprogress(event.loaded);
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Netzwerkfehler'));
      xhr.send(chunk);
    });
  }

  async function upload(entry: Upload, replace = false): Promise<void> {
    entry.status = 'uploading';
    entry.error = undefined;
    entry.progress = 0;
    try {
      const { uploadUrl } = await sendApi<{ uploadUrl: string }>(
        'POST',
        '/intern/pflege/downloads/upload',
        {
          fileName: entry.file.name,
          size: entry.file.size,
          replace,
        }
      );
      const total = entry.file.size;
      for (let start = 0; start < total; start += CHUNK_SIZE) {
        const chunk = entry.file.slice(start, Math.min(start + CHUNK_SIZE, total));
        await putChunk(uploadUrl, chunk, start, total, (loaded) => {
          entry.progress = Math.round(((start + loaded) / total) * 100);
        });
      }
      entry.status = 'done';
      entry.progress = 100;
      message = `${entry.file.name} hochgeladen.`;
      messageKind = 'success';
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'EXISTS') {
        entry.status = 'exists';
      } else {
        entry.status = 'error';
        entry.error = error instanceof ApiError ? error.message : 'Hochladen fehlgeschlagen.';
      }
    }
  }

  function addFiles(list: FileList | null | undefined): void {
    for (const file of Array.from(list ?? [])) {
      uploads.push({ file, progress: 0, status: 'uploading' });
      void upload(uploads[uploads.length - 1]);
    }
  }

  function onfilechange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(input.files);
    input.value = '';
  }

  function ondrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    addFiles(event.dataTransfer?.files);
  }

  function startRename(file: StaffDownload): void {
    renaming = { file, name: file.fileName };
    renameError = null;
  }

  async function saveRename(): Promise<void> {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (name === renaming.file.fileName) {
      renaming = null;
      return;
    }
    busy = true;
    renameError = null;
    try {
      await sendApi('PATCH', `/intern/pflege/downloads/${encodeURIComponent(renaming.file.id)}`, {
        fileName: name,
      });
      message = `Umbenannt in ${name}.`;
      messageKind = 'success';
      renaming = null;
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      renameError = error instanceof ApiError ? error.message : 'Umbenennen fehlgeschlagen.';
    } finally {
      busy = false;
    }
  }

  async function remove(file: StaffDownload): Promise<void> {
    busy = true;
    try {
      await sendApi('DELETE', `/intern/pflege/downloads/${encodeURIComponent(file.id)}`);
      message = `${file.fileName} gelöscht.`;
      messageKind = 'success';
      confirmDeleteId = null;
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      message = error instanceof ApiError ? error.message : 'Löschen fehlgeschlagen.';
      messageKind = 'error';
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  <section aria-labelledby="upload-heading">
    <h2 id="upload-heading" class="sr-only">Dateien hochladen</h2>
    <label
      class="surface flex cursor-pointer flex-col items-center justify-center gap-2 border-2! border-dashed! p-8 text-center transition {dragging
        ? 'border-[var(--color-brand-500)]! bg-[var(--color-brand-50)]'
        : 'border-[var(--color-brand-200)]!'}"
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      {ondrop}
    >
      <svg
        aria-hidden="true"
        class="size-8 text-brand-700"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <span class="font-semibold text-brand-900">Dateien hierher ziehen oder auswählen</span>
      <span class="text-xs text-neutral-700"
        >Bis 250 MB pro Datei. Erscheint sofort auf der Downloads-Seite.</span
      >
      <input type="file" multiple class="sr-only" onchange={onfilechange} />
    </label>

    {#if uploads.length > 0}
      <ul class="mt-3 space-y-2" aria-live="polite">
        {#each uploads as entry, index (index)}
          <li class="surface p-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <span class="truncate font-semibold">{entry.file.name}</span>
              <span class="shrink-0 text-neutral-700">
                {#if entry.status === 'uploading'}{entry.progress} %{:else if entry.status === 'done'}Fertig{/if}
              </span>
            </div>
            {#if entry.status === 'uploading' || entry.status === 'done'}
              <progress
                class="upload-progress mt-2 h-1.5 w-full"
                max="100"
                value={entry.progress}
                aria-label="Fortschritt {entry.file.name}"
              ></progress>
            {:else if entry.status === 'exists'}
              <p class="mt-2 flex flex-wrap items-center gap-2">
                Eine Datei mit diesem Namen gibt es bereits.
                <button type="button" class="btn-danger" onclick={() => upload(entry, true)}
                  >Ersetzen</button
                >
                <button type="button" class="btn-secondary" onclick={() => uploads.splice(index, 1)}
                  >Abbrechen</button
                >
              </p>
            {:else}
              <p class="mt-2 text-[var(--color-dpsg-red)]">
                {entry.error}
                <button type="button" class="ml-2 underline" onclick={() => upload(entry)}
                  >Erneut versuchen</button
                >
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" />
    <button
      type="button"
      class="btn-secondary"
      disabled={store.loading}
      onclick={() => downloadsPflege.load({ force: true })}
    >
      Neu laden
    </button>
  </div>

  {#if !store.data && store.loading}
    <div role="status" aria-live="polite" class="space-y-2">
      <span class="sr-only">Downloads werden geladen …</span>
      {#each [1, 2, 3] as n (n)}
        <div class="skeleton-element h-16 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else if !store.data}
    <div role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
      <p class="text-sm text-neutral-700">{store.error}</p>
    </div>
  {:else if files.length === 0}
    <p class="surface p-6 text-sm text-neutral-700">Noch keine Downloads vorhanden.</p>
  {:else}
    <ul class="space-y-2">
      {#each files as file (file.id)}
        <li class="surface flex flex-wrap items-center gap-3 p-3">
          {#if file.hasPreview}
            <img
              src={getDownloadPreviewUrl(file.id, 'small')}
              alt=""
              aria-hidden="true"
              width="48"
              height="48"
              class="size-12 shrink-0 rounded object-cover"
            />
          {:else}
            <span
              aria-hidden="true"
              class="flex size-12 shrink-0 items-center justify-center rounded bg-[var(--color-brand-50)] text-xs font-semibold uppercase text-brand-800"
            >
              {file.fileName.split('.').pop()}
            </span>
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-brand-900">{file.fileName}</span>
            <span class="block text-xs text-neutral-700">
              {formatFileSize(file.size)} · {dateFormatter.format(new Date(file.lastModifiedAt))} · {file.lastModifiedBy}
            </span>
          </span>
          <span class="flex flex-wrap gap-2">
            {#if confirmDeleteId === file.id}
              <span class="flex items-center gap-2 text-sm">
                Wirklich löschen?
                <button
                  type="button"
                  class="btn-danger"
                  disabled={busy}
                  onclick={() => remove(file)}>Ja</button
                >
                <button
                  type="button"
                  class="btn-secondary"
                  disabled={busy}
                  onclick={() => (confirmDeleteId = null)}>Nein</button
                >
              </span>
            {:else}
              <button type="button" class="btn-secondary" onclick={() => startRename(file)}>
                Umbenennen<span class="sr-only"> ({file.fileName})</span>
              </button>
              <button type="button" class="btn-danger" onclick={() => (confirmDeleteId = file.id)}>
                Löschen<span class="sr-only"> ({file.fileName})</span>
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<EditDialog
  open={renaming !== null}
  title="Datei umbenennen"
  {busy}
  error={renameError}
  onsubmit={saveRename}
  onclose={() => {
    if (!busy) renaming = null;
  }}
>
  {#if renaming}
    <FormField
      id="dl-name"
      label="Dateiname"
      hint="Mit Dateiendung, z. B. „Anmeldung-Sommerlager.pdf“"
    >
      {#snippet children(attrs)}
        <input {...attrs} class="form-input" maxlength="200" bind:value={renaming!.name} />
      {/snippet}
    </FormField>
  {/if}
</EditDialog>

<style>
  .upload-progress {
    appearance: none;
    border-radius: 999px;
    overflow: hidden;
    background: var(--color-neutral-200);
  }
  .upload-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .upload-progress::-webkit-progress-value {
    background: var(--color-dpsg-pfadfinder);
  }
  .upload-progress::-moz-progress-bar {
    background: var(--color-dpsg-pfadfinder);
  }
</style>
