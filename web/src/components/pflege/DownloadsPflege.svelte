<script lang="ts">
  import { formatDay } from '../../lib/format';
  import MessageText from '../ui/MessageText.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { untrack } from 'svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { makeDownloadPreview } from '../../lib/downloadPreview';
  import { downloadsPflege } from '../../lib/pflegeStore.svelte';
  import { formatFileSize, getDownloadPreviewUrl } from '../../lib/downloadsStore.svelte';
  import type { StaffDownload } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Upload {
    file: File;
    progress: number;
    status: 'uploading' | 'exists' | 'done' | 'error';
    error?: string;
    /** Set once all parts arrived; „Ersetzen“ and retries then only complete the upload. */
    uploadId?: string;
    preview?: string;
    /** Chosen with „Ersetzen“; kept for „Erneut versuchen“. */
    replace?: boolean;
  }

  const UPLOAD = '/intern/pflege/downloads/upload';

  const store = downloadsPflege.state;

  let uploads = $state<Upload[]>([]);
  let dragging = $state(false);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let renaming = $state<{ file: StaffDownload; name: string } | null>(null);
  let renameError = $state<string | null>(null);
  let busy = $state(false);

  const files = $derived(
    [...(store.data ?? [])].sort((a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt))
  );

  $effect(() => {
    untrack(() => downloadsPflege.load());
  });

  /** Sends the file in parts; the API puts them together when the upload is completed. */
  async function sendParts(entry: Upload): Promise<string> {
    const { uploadId, partSize } = await sendApi<{ uploadId: string; partSize: number }>(
      'POST',
      UPLOAD,
      { fileName: entry.file.name, size: entry.file.size, replace: entry.replace === true }
    );
    const total = entry.file.size;
    for (let start = 0, index = 0; start < total; start += partSize, index++) {
      const part = entry.file.slice(start, Math.min(start + partSize, total));
      await sendApi('PUT', `${UPLOAD}/${uploadId}/${index}`, part);
      // The last few percent stand for saving
      entry.progress = Math.round(((start + part.size) / total) * 95);
    }
    return uploadId;
  }

  async function upload(entry: Upload): Promise<void> {
    const replace = entry.replace === true;
    entry.status = 'uploading';
    entry.error = undefined;
    try {
      if (!entry.uploadId) {
        entry.progress = 0;
        const [uploadId, preview] = await Promise.all([
          sendParts(entry),
          entry.preview ?? makeDownloadPreview(entry.file),
        ]);
        entry.uploadId = uploadId;
        entry.preview = preview;
      }
      const complete = (): Promise<unknown> =>
        sendApi('POST', `${UPLOAD}/${entry.uploadId}`, {
          fileName: entry.file.name,
          size: entry.file.size,
          replace,
          preview: entry.preview,
        });
      try {
        await complete();
      } catch (error: unknown) {
        // The preview is optional: a refused one never stops the file itself
        if (!(error instanceof ApiError && error.fields?.preview && entry.preview)) throw error;
        entry.preview = undefined;
        await complete();
      }
      entry.status = 'done';
      entry.progress = 100;
      message = replace ? `${entry.file.name} ersetzt.` : `${entry.file.name} hochgeladen.`;
      messageKind = 'success';
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'EXISTS') {
        entry.status = 'exists';
        return;
      }
      // The parts are gone or incomplete: the next try uploads the file again
      if (error instanceof ApiError && error.code === 'INCOMPLETE') entry.uploadId = undefined;
      entry.status = 'error';
      entry.error = errorMessage(
        error,
        `Die Datei „${entry.file.name}“ wurde nicht hochgeladen. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.`
      );
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
        etag: renaming.file.etag,
      });
      message = `Umbenannt in ${name}.`;
      messageKind = 'success';
      renaming = null;
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        await refreshRenaming();
        renameError =
          'Jemand anderes hat die Datei inzwischen geändert, sie wurde nicht umbenannt. Dein neuer Name ist noch da. Tippe noch einmal auf „Speichern“.';
        return;
      }
      renameError = errorMessage(
        error,
        'Die Datei wurde nicht umbenannt. Dein neuer Name ist noch da. Tippe noch einmal auf „Speichern“.'
      );
    } finally {
      busy = false;
    }
  }

  /** After a change by someone else: the newest version, so „Speichern“ works again. */
  async function refreshRenaming(): Promise<void> {
    await downloadsPflege.load({ force: true });
    const fresh = store.data?.find((candidate) => candidate.id === renaming?.file.id);
    if (renaming && fresh) renaming.file = fresh;
  }

  async function remove(file: StaffDownload): Promise<void> {
    busy = true;
    try {
      await sendApi(
        'DELETE',
        `/intern/pflege/downloads/${encodeURIComponent(file.id)}`,
        undefined,
        {
          etag: file.etag,
        }
      );
      message = `${file.fileName} gelöscht.`;
      messageKind = 'success';
      await downloadsPflege.load({ force: true });
    } catch (error: unknown) {
      messageKind = 'error';
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        message = `Jemand anderes hat „${file.fileName}“ inzwischen geändert, sie wurde nicht gelöscht. Die Liste zeigt jetzt den neuen Stand. Prüfe die Datei und tippe noch einmal auf „Löschen“.`;
        await downloadsPflege.load({ force: true });
        return;
      }
      message = errorMessage(
        error,
        `Die Datei „${file.fileName}“ wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.`
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  <section aria-labelledby="upload-heading">
    <h2 id="upload-heading" class="sr-only">Dateien hochladen</h2>
    <label
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center transition-colors {dragging
        ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]'
        : 'border-neutral-300 hover:border-[var(--color-brand-500)]'}"
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
      <ul class="mt-3 divide-y divide-neutral-200 border-b border-neutral-200" aria-live="polite">
        {#each uploads as entry, index (index)}
          <li class="py-3 text-sm">
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
                <ActionButton
                  variant="danger"
                  type="button"
                  onclick={() => {
                    entry.replace = true;
                    void upload(entry);
                  }}>Ersetzen</ActionButton
                >
                <ActionButton
                  variant="secondary"
                  type="button"
                  onclick={() => uploads.splice(index, 1)}>Abbrechen</ActionButton
                >
              </p>
            {:else}
              <p class="mt-2 text-danger">
                <MessageText text={entry.error ?? ''} />
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
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" popup />
    <ReloadButton resource={downloadsPflege} />
  </div>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Downloads werden geladen …"
    onretry={() => void downloadsPflege.load({ force: true })}
    isEmpty={() => files.length === 0}
  >
    {#snippet skeleton()}
      <div class="space-y-2">
        {#each [1, 2, 3] as n (n)}
          <div class="skeleton-element h-16 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet empty()}
      <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
        Noch keine Downloads vorhanden.
      </p>
    {/snippet}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each files as file (file.id)}
        <li class="flex flex-wrap items-center gap-3 py-3">
          {#if file.hasPreview}
            <img
              src={getDownloadPreviewUrl(file.id, 'small')}
              alt=""
              aria-hidden="true"
              width="48"
              height="48"
              class="size-12 shrink-0 rounded-sm border border-neutral-200 object-cover object-top"
            />
          {:else}
            <span
              aria-hidden="true"
              class="w-12 shrink-0 text-center text-xs font-semibold text-neutral-700"
            >
              {file.fileName.split('.').pop()}
            </span>
          {/if}
          <span class="min-w-0 flex-1 basis-48">
            <span class="block font-semibold break-words text-brand-900">{file.fileName}</span>
            <span class="block text-sm text-neutral-700">
              {formatFileSize(file.size)} · {formatDay(file.lastModifiedAt)} · {file.lastModifiedBy}
            </span>
          </span>
          <span class="flex flex-wrap gap-2">
            <ActionButton variant="secondary" type="button" onclick={() => startRename(file)}>
              Umbenennen<span class="sr-only"> ({file.fileName})</span>
            </ActionButton>
            <ActionButton
              variant="danger"
              type="button"
              disabled={busy}
              onclick={async () => {
                if (
                  await confirmAction({
                    title: `„${file.fileName}“ löschen?`,
                    message: `${file.fileName} endgültig löschen?`,
                  })
                )
                  await remove(file);
              }}
            >
              Löschen<span class="sr-only"> ({file.fileName})</span>
            </ActionButton>
          </span>
        </li>
      {/each}
    </ul>
  </LoadState>
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
    border-radius: 0;
    overflow: hidden;
    background: var(--color-neutral-200);
  }
  .upload-progress::-webkit-progress-bar {
    background: var(--color-neutral-200);
  }
  .upload-progress::-webkit-progress-value {
    background: var(--color-success);
  }
  .upload-progress::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
