<script lang="ts">
  import { untrack } from 'svelte';
  import {
    downloadsStore,
    fetchDownloads,
    getDownloadPreviewUrl,
    getDownloadFileUrl,
    formatFileSize,
  } from '../lib/downloadsStore.svelte';

  let loadedImages = $state<Set<string>>(new Set());

  $effect(() => {
    untrack(() => {
      fetchDownloads();
    });
  });

  function formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function getFileExtension(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? (parts.pop()?.toUpperCase() ?? '') : '';
  }

  function handleHighResLoad(fileId: string): void {
    loadedImages = new Set([...loadedImages, fileId]);
  }

  function isHighResLoaded(fileId: string): boolean {
    return loadedImages.has(fileId);
  }
</script>

{#if downloadsStore.loading}
  <div role="status" aria-live="polite" data-testid="downloads-grid">
    <span class="sr-only">Downloads werden geladen...</span>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-hidden="true">
      {#each [1, 2, 3, 4, 5, 6] as i (i)}
        <li class="skeleton-card flex items-center gap-4 py-4">
          <div class="skeleton-element h-20 w-14 shrink-0 rounded-sm"></div>
          <div class="flex-1 space-y-2">
            <div class="skeleton-element h-5 w-1/2 rounded-sm"></div>
            <div class="skeleton-element h-4 w-1/3 rounded-sm"></div>
          </div>
          <div class="skeleton-element hidden h-11 w-36 rounded-sm sm:block"></div>
        </li>
      {/each}
    </ul>
  </div>
{:else if downloadsStore.error}
  <div
    role="alert"
    class="border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5"
    aria-labelledby="downloads-error-heading"
    data-testid="downloads-grid"
  >
    <h3 id="downloads-error-heading" class="font-semibold text-brand-900">
      Daten konnten nicht geladen werden
    </h3>
    <p class="mt-1 text-neutral-700">
      Die Downloads konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
    </p>
  </div>
{:else if downloadsStore.data && downloadsStore.data.length > 0}
  <!-- One ruled list like a table of contents: preview, name and details, download -->
  <ul class="divide-y divide-neutral-200 border-y border-neutral-200" data-testid="downloads-grid">
    {#each downloadsStore.data as file (file.id)}
      <li>
        <article
          class="flex flex-wrap items-center gap-x-5 gap-y-3 py-4 sm:flex-nowrap"
          aria-labelledby="download-{file.id}-heading"
        >
          <a
            href={getDownloadFileUrl(file.id)}
            class="relative block aspect-[210/297] w-14 shrink-0 overflow-hidden rounded-sm border border-neutral-200 bg-neutral-100 sm:w-16"
            download={file.fileName}
            aria-label="Vorschau von {file.fileName}"
          >
            <img
              src={getDownloadPreviewUrl(file.id, 'small')}
              alt=""
              aria-hidden="true"
              class="preview-image preview-image-low absolute inset-0 h-full w-full object-cover"
              class:preview-image-hidden={isHighResLoaded(file.id)}
              loading="lazy"
              decoding="async"
            />
            <img
              src={getDownloadPreviewUrl(file.id, 'large')}
              alt=""
              aria-hidden="true"
              class="preview-image preview-image-high absolute inset-0 h-full w-full object-cover"
              class:preview-image-loaded={isHighResLoaded(file.id)}
              loading="lazy"
              decoding="async"
              onload={() => handleHighResLoad(file.id)}
            />
          </a>

          <div class="min-w-0 flex-1 basis-48">
            <h3
              id="download-{file.id}-heading"
              class="font-semibold leading-snug break-words text-brand-900"
              title={file.fileName}
            >
              {file.fileName}
            </h3>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
              {#if getFileExtension(file.fileName)}
                <span>{getFileExtension(file.fileName)}</span>
                <span aria-hidden="true">·</span>
              {/if}
              <span class="tabular-nums">{formatFileSize(file.size)}</span>
              <span aria-hidden="true">·</span>
              <span class="tabular-nums">
                <span class="sr-only">Stand:</span>
                {formatDate(file.lastModifiedAt)}
              </span>
            </p>
          </div>

          <a
            href={getDownloadFileUrl(file.id)}
            download={file.fileName}
            class="download-button btn-secondary ml-[4.75rem] no-underline sm:ml-0"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Herunterladen<span class="sr-only">: {file.fileName}</span>
          </a>
        </article>
      </li>
    {/each}
  </ul>
{:else}
  <p
    id="no-downloads-heading"
    class="border-y border-neutral-200 py-6 text-neutral-700"
    data-testid="downloads-grid"
  >
    Aktuell sind keine Downloads verfügbar.
  </p>
{/if}

<style>
  .preview-image {
    transition: opacity 0.4s ease;
  }

  .preview-image-low {
    opacity: 1;
  }

  .preview-image-low.preview-image-hidden {
    opacity: 0;
  }

  .preview-image-high {
    opacity: 0;
  }

  .preview-image-high.preview-image-loaded {
    opacity: 1;
  }
</style>
