<script lang="ts">
  import { untrack } from "svelte";
  import {
    downloadsStore,
    fetchDownloads,
    getDownloadPreviewUrl,
    getDownloadFileUrl,
    formatFileSize,
  } from "../lib/downloadsStore.svelte";

  let loadedImages = $state<Set<string>>(new Set());

  $effect(() => {
    untrack(() => {
      fetchDownloads();
    });
  });

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function getFileExtension(fileName: string): string {
    const parts = fileName.split(".");
    return parts.length > 1 ? parts.pop()?.toUpperCase() ?? "" : "";
  }

  function handleHighResLoad(fileId: string): void {
    loadedImages = new Set([...loadedImages, fileId]);
  }

  function isHighResLoaded(fileId: string): boolean {
    return loadedImages.has(fileId);
  }
</script>

<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
  {#if downloadsStore.loading}
    <div role="status" aria-live="polite" class="sr-only">
      Downloads werden geladen...
    </div>
    {#each [1, 2, 3, 4, 5, 6] as i}
      <article class="skeleton-card surface overflow-hidden">
        <div class="relative aspect-[210/297] w-full">
          <div class="skeleton-element w-full h-full"></div>
          <div class="absolute top-3 right-3 skeleton-element w-10 h-5 rounded"></div>
        </div>
        <div class="p-4 space-y-3">
          <div class="skeleton-element h-5 w-3/4 rounded"></div>
          <div class="flex items-center gap-3">
            <div class="skeleton-element h-4 w-16 rounded"></div>
            <div class="skeleton-element h-4 w-20 rounded"></div>
          </div>
          <div class="skeleton-element h-10 w-full rounded-md mt-auto"></div>
        </div>
      </article>
    {/each}
  {:else if downloadsStore.error}
    <div class="sm:col-span-2 lg:col-span-3">
      <article
        role="alert"
        class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]"
        aria-labelledby="downloads-error-heading"
      >
        <div class="flex items-start gap-4">
          <div
            class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-dpsg-red)]/10 flex items-center justify-center"
          >
            <svg
              aria-hidden="true"
              class="w-5 h-5 text-[var(--color-dpsg-red)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3
              id="downloads-error-heading"
              class="text-lg font-semibold text-[var(--color-brand-900)]"
            >
              Daten konnten nicht geladen werden
            </h3>
            <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
              Die Downloads konnten leider nicht abgerufen werden. Bitte
              versuche es später erneut.
            </p>
          </div>
        </div>
      </article>
    </div>
  {:else if downloadsStore.data && downloadsStore.data.length > 0}
    {#each downloadsStore.data as file (file.id)}
      <article
        class="download-card surface overflow-hidden flex flex-col"
        aria-labelledby="download-{file.id}-heading"
      >
        <a
          href={getDownloadFileUrl(file.id)}
          class="block relative aspect-[210/297] bg-[var(--color-neutral-100)] overflow-hidden group"
          download={file.fileName}
          aria-label="Vorschau von {file.fileName}"
        >
          <img
            src={getDownloadPreviewUrl(file.id, "small")}
            alt=""
            aria-hidden="true"
            class="preview-image preview-image-low absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            class:preview-image-hidden={isHighResLoaded(file.id)}
            loading="lazy"
            decoding="async"
          />
          <img
            src={getDownloadPreviewUrl(file.id, "large")}
            alt=""
            aria-hidden="true"
            class="preview-image preview-image-high absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            class:preview-image-loaded={isHighResLoaded(file.id)}
            loading="lazy"
            decoding="async"
            onload={() => handleHighResLoad(file.id)}
          />
          <div
            class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          ></div>
          <div
            class="absolute top-3 right-3 px-2 py-1 rounded bg-[var(--color-brand-900)]/90 text-white text-xs font-semibold uppercase tracking-wide"
          >
            {getFileExtension(file.fileName)}
          </div>
        </a>

        <div class="p-4 flex flex-col flex-1">
          <h3
            id="download-{file.id}-heading"
            class="text-base font-semibold text-[var(--color-brand-900)] line-clamp-2 leading-snug"
            title={file.fileName}
          >
            {file.fileName}
          </h3>

          <div
            class="mt-2 flex items-center gap-3 text-sm text-[var(--color-neutral-700)]"
          >
            <span class="flex items-center gap-1.5">
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {formatFileSize(file.size)}
            </span>
            <span class="flex items-center gap-1.5">
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {formatDate(file.lastModifiedAt)}
            </span>
          </div>

          <div class="mt-auto pt-4">
            <a
              href={getDownloadFileUrl(file.id)}
              download={file.fileName}
              class="download-button flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-[var(--color-brand-800)] text-white text-sm font-semibold transition-all duration-200 hover:bg-[var(--color-brand-900)] hover:shadow-lift focus-visible:ring-2 focus-visible:ring-[var(--color-dpsg-red)] focus-visible:ring-offset-2"
            >
              <svg
                class="w-4 h-4"
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
              Herunterladen
            </a>
          </div>
        </div>
      </article>
    {/each}
  {:else}
    <div class="sm:col-span-2 lg:col-span-3">
      <article class="surface p-6" aria-labelledby="no-downloads-heading">
        <div class="flex items-center gap-4">
          <div
            class="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center"
          >
            <svg
              class="w-6 h-6 text-[var(--color-brand-600)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p
            id="no-downloads-heading"
            class="text-[var(--color-neutral-700)]"
          >
            Aktuell sind keine Downloads verfügbar.
          </p>
        </div>
      </article>
    </div>
  {/if}
</div>

<style>
  .download-card {
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }

  .download-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lift);
  }

  .preview-image {
    transition:
      opacity 0.4s ease,
      transform 0.3s ease;
  }

  .preview-image-low {
    filter: blur(8px);
    transform: scale(1.05);
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

  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .skeleton-element {
    background: linear-gradient(
      110deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 40%,
      var(--color-neutral-200) 60%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.85;
    }
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
