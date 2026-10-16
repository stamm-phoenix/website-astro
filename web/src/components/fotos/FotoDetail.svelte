<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { errorMessage, fetchApi } from '../../lib/api';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import { saveFotoFile } from '../../lib/fotoDownload.svelte';
  import { formatDateTime } from '../../lib/format';
  import type { FotoFile, FotoFileDetail } from '../../lib/types';
  import MessageText from '../ui/MessageText.svelte';

  interface Props {
    files: FotoFile[];
    index: number;
    onindex: (index: number) => void;
    onclose: () => void;
  }
  let { files, index, onindex, onclose }: Props = $props();

  /** SharePoint's links last about an hour; renew them well before. */
  const DETAIL_MAX_AGE_MS = 45 * 60_000;
  const id = $props.id();
  let dialog = $state<HTMLDialogElement | null>(null);
  /** Loaded details with the time they were loaded; their links expire after about an hour. */
  let details = $state<Record<string, { data: FotoFileDetail; loadedAt: number }>>({});
  /** Advances every minute, so links are renewed while a photo stays open. */
  let now = $state(Date.now());
  let detailError = $state<string | null>(null);
  /**
   * Player of the shown video, kept while it plays, so renewing the links does not restart it;
   * empty when SharePoint has no player for the file.
   */
  let playingUrl = $state<string | null>(null);
  /**
   * The video played by the browser itself, straight from SharePoint; kept for the shown file,
   * so renewing the links does not restart it. If the browser cannot play the format, SharePoint's
   * player is offered instead.
   */
  let videoSrc = $state<string | null>(null);
  let videoFailed = $state(false);
  let downloading = $state(false);
  let downloadNote = $state<string | null>(null);
  /** Whether the large version of the current photo has loaded, to replace the small one. */
  let largeLoaded = $state<string | null>(null);
  let touchStart: { x: number; y: number } | null = null;

  const file = $derived(files[index]);
  const detail = $derived.by(() => {
    const entry = file ? details[file.id] : undefined;
    return entry && now - entry.loadedAt < DETAIL_MAX_AGE_MS ? entry.data : undefined;
  });
  const downloadUrl = $derived(detail?.downloadUrl ?? null);
  const meta = $derived(
    file
      ? [
          file.takenAt ? `Aufgenommen ${formatDateTime(file.takenAt)}` : '',
          formatFileSize(file.size),
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
  );

  onMount(() => {
    dialog?.showModal();
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => {
      clearInterval(timer);
      dialog?.close();
    };
  });

  // Another file stops the player of the previous one
  $effect(() => {
    if (file)
      untrack(() => {
        playingUrl = null;
        videoSrc = null;
        videoFailed = false;
        downloadNote = null;
      });
  });

  // The first link of a video is kept while it is shown
  $effect(() => {
    const url = file?.kind === 'video' ? detail?.downloadUrl : null;
    if (url) untrack(() => (videoSrc ??= url));
  });

  // Loads the details of the shown file, and again once their links are about to expire
  $effect(() => {
    const current = file;
    const missing = !detail;
    untrack(() => {
      detailError = null;
      if (!current || !missing) return;
      fetchApi<FotoFileDetail>(`/intern/fotos/dateien/${encodeURIComponent(current.id)}`)
        .then((loaded) => (details[current.id] = { data: loaded, loadedAt: Date.now() }))
        .catch((error: unknown) => {
          if (files[index]?.id === current.id) {
            detailError = errorMessage(
              error,
              'Die große Ansicht konnte nicht geladen werden. Prüfe deine Internetverbindung und öffne das Foto noch einmal.'
            );
          }
        });
    });
  });

  // Load the neighbours' previews ahead, so swiping shows them at once
  $effect(() => {
    for (const neighbour of [files[index + 1], files[index - 1]]) {
      if (neighbour?.thumbnailUrl) new Image().src = neighbour.thumbnailUrl;
    }
  });

  /** Saves the shown file without leaving the view, so a playing video keeps playing. */
  async function download(url: string): Promise<void> {
    const current = file;
    if (!current) return;
    downloading = true;
    downloadNote = `„${current.name}“ wird heruntergeladen …`;
    try {
      await saveFotoFile(url, current.name, current.size);
      if (file?.id === current.id) {
        downloadNote = `Download gestartet. Du findest „${current.name}“ bei deinen Downloads.`;
      }
    } catch (error: unknown) {
      if (file?.id === current.id) {
        downloadNote = error instanceof Error ? error.message : String(error);
      }
    } finally {
      downloading = false;
    }
  }

  function go(step: number): void {
    const next = index + step;
    if (next >= 0 && next < files.length) onindex(next);
  }

  function onkeydown(event: KeyboardEvent): void {
    // The arrow keys of a focused video player seek within the video
    if (event.target instanceof HTMLVideoElement || event.defaultPrevented) return;
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
  }

  function ontouchstart(event: TouchEvent): void {
    const touch = event.touches[0];
    touchStart = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function ontouchend(event: TouchEvent): void {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }
</script>

<dialog
  bind:this={dialog}
  class="foto-detail m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
  aria-labelledby={`${id}-title`}
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
  {onkeydown}
>
  {#if file}
    <div class="flex h-full flex-col text-white">
      <div class="flex items-center gap-2 px-2 py-1">
        <p class="shrink-0 px-2 text-sm tabular-nums" aria-live="polite">
          {index + 1} von {files.length}
        </p>
        <h2 id={`${id}-title`} class="min-w-0 flex-1 truncate text-sm font-semibold">
          {file.name}
        </h2>
        <button
          type="button"
          class="viewer-button"
          aria-label="Große Ansicht schließen"
          onclick={onclose}
        >
          <svg
            aria-hidden="true"
            class="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
          >
        </button>
      </div>

      <div
        class="relative flex min-h-0 flex-1 items-center justify-center"
        role="group"
        aria-label="Wische zur Seite für das nächste oder vorherige Foto"
        {ontouchstart}
        {ontouchend}
      >
        {#if file.kind === 'video' && videoSrc && !videoFailed && !playingUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            src={videoSrc}
            poster={file.thumbnailUrl ?? undefined}
            controls
            playsinline
            preload="metadata"
            class="max-h-full max-w-full bg-black"
            aria-label={`Video ${file.name}`}
            onerror={() => (videoFailed = true)}
          ></video>
        {:else if file.kind === 'video' && playingUrl}
          <iframe
            src={playingUrl}
            title={`Video ${file.name}`}
            class="aspect-video max-h-full w-full max-w-5xl border-0 bg-black"
            allow="autoplay; fullscreen"
            allowfullscreen
          ></iframe>
        {:else if file.thumbnailUrl || detail?.imageUrl}
          {@const large = detail?.imageUrl ?? null}
          <img
            src={large && largeLoaded === large ? large : (file.thumbnailUrl ?? large)}
            alt={file.kind === 'video' ? `Vorschau des Videos ${file.name}` : file.name}
            width={file.width ?? 1600}
            height={file.height ?? 1200}
            class="max-h-full max-w-full object-contain"
          />
          {#if large && largeLoaded !== large}
            <!-- Loads the large version in the background and then replaces the preview -->
            <img
              src={large}
              alt=""
              aria-hidden="true"
              width="1"
              height="1"
              class="hidden"
              onload={() => (largeLoaded = large)}
            />
          {/if}
        {:else if file.kind !== 'video'}
          <p class="max-w-sm px-6 text-center">
            Für „{file.name}“ gibt es keine Vorschau. Du kannst die Datei herunterladen oder in
            SharePoint öffnen.
          </p>
        {/if}
        {#if file.kind === 'video' && !videoSrc && !playingUrl}
          <p class="viewer-button absolute inset-auto px-5" role="status">
            Video wird vorbereitet …
          </p>
        {:else if file.kind === 'video' && videoFailed && detail?.embedUrl && !playingUrl}
          <!-- The browser cannot play this format: SharePoint's player can -->
          <button
            type="button"
            class="viewer-button absolute inset-auto gap-2 px-5"
            onclick={() => (playingUrl = detail?.embedUrl ?? '')}
          >
            <svg aria-hidden="true" class="size-6" viewBox="0 0 24 24" fill="currentColor"
              ><path d="M8 5v14l11-7z" /></svg
            >
            Video abspielen
          </button>
        {/if}

        {#if index > 0}
          <button
            type="button"
            class="viewer-button absolute left-1 top-1/2 -translate-y-1/2"
            aria-label="Vorheriges Foto"
            onclick={() => go(-1)}
          >
            <svg
              aria-hidden="true"
              class="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg
            >
          </button>
        {/if}
        {#if index < files.length - 1}
          <button
            type="button"
            class="viewer-button absolute right-1 top-1/2 -translate-y-1/2"
            aria-label="Nächstes Foto"
            onclick={() => go(1)}
          >
            <svg
              aria-hidden="true"
              class="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg
            >
          </button>
        {/if}
      </div>

      <div class="space-y-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p class="text-sm text-white/80">{meta}</p>
        {#if file.kind === 'video' && (playingUrl === '' || (videoFailed && detail && !detail.embedUrl))}
          <p class="text-sm">
            Dieses Video lässt sich hier nicht abspielen. Lade es herunter oder öffne es in
            SharePoint.
          </p>
        {:else if file.kind === 'video' && videoSrc && !videoFailed && !playingUrl && detail?.embedUrl}
          <button
            type="button"
            class="min-h-11 text-sm text-white/80 underline underline-offset-2"
            onclick={() => (playingUrl = detail?.embedUrl ?? '')}
            >Video bleibt schwarz oder ohne Bild? Im Player von SharePoint abspielen</button
          >
        {/if}
        {#if downloadNote}
          <p class="text-sm" role="status">{downloadNote}</p>
        {/if}
        {#if detailError}
          <p class="text-sm" role="alert"><MessageText text={detailError} /></p>
        {/if}
        <div class="flex flex-wrap gap-2">
          {#if downloadUrl}
            <button
              type="button"
              class="btn-primary"
              disabled={downloading}
              aria-busy={downloading}
              onclick={() => void download(downloadUrl)}
            >
              {downloading ? 'Wird heruntergeladen …' : 'Herunterladen'}
            </button>
          {:else}
            <span class="btn-primary opacity-60" aria-disabled="true">
              {detailError ? 'Herunterladen nicht möglich' : 'Download wird vorbereitet …'}
            </span>
          {/if}
          {#if file.webUrl}
            <a
              class="btn-secondary viewer-secondary"
              href={file.webUrl}
              target="_blank"
              rel="noopener">In SharePoint öffnen<span class="sr-only"> (öffnet neuen Tab)</span></a
            >
          {/if}
        </div>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .foto-detail {
    color-scheme: dark;
  }
  .foto-detail::backdrop {
    background: #000;
  }
  .foto-detail[open] {
    display: block;
    background: #000;
  }
  .viewer-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    min-height: 2.75rem;
    border-radius: 9999px;
    background: rgb(0 0 0 / 0.5);
    color: white;
  }
  .viewer-button:hover {
    background: rgb(0 0 0 / 0.75);
  }
  .viewer-button:disabled {
    opacity: 0.7;
  }
  .viewer-secondary {
    color: white;
    border-color: rgb(255 255 255 / 0.7);
    background: transparent;
  }
</style>
