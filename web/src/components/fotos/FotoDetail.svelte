<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { errorMessage, fetchApi } from '../../lib/api';
  import { formatFileSize } from '../../lib/downloadsStore.svelte';
  import { saveFotoFile } from '../../lib/fotoDownload.svelte';
  import { formatDateTime } from '../../lib/format';
  import {
    SWIPE_START,
    commits,
    moveTrack,
    panelDuration,
    releaseVelocity,
    rubberBand,
    settleDuration,
    settleEasing,
    settleTransition,
    startTrack,
    type SwipeTrack,
  } from '../../lib/swipe';
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
  /** The browser plays only the sound (e.g. HEVC in Chrome); SharePoint's player shows the picture. */
  let soundOnly = $state(false);
  let downloading = $state(false);
  let downloadNote = $state<string | null>(null);
  /** Whether the large version of the current photo has loaded, to replace the small one. */
  let largeLoaded = $state<string | null>(null);
  /** Horizontal distance the shown file follows the finger; 0 at rest. */
  let offset = $state(0);
  /** Duration of the movement back to rest; 0 while the finger moves and for a change of photo. */
  let settleMs = $state(0);
  /** Curve of the settle back, starting at the speed of the released finger. */
  let settleCurve = $state('var(--motion-enter)');
  /** The touch being followed, and whether it moves sideways (`x`) or is left to the browser. */
  let swipe: { track: SwipeTrack; axis: 'x' | null; width: number } | null = null;

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
        soundOnly = false;
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

  // A video found without a picture before the player of SharePoint was known
  $effect(() => {
    if (soundOnly && playingUrl === null && detail?.embedUrl) playingUrl = detail.embedUrl;
  });

  /** A video without a picture after loading: switch to SharePoint's player. */
  function checkPicture(video: HTMLVideoElement): void {
    if (video.videoWidth > 0) return;
    soundOnly = true;
    videoFailed = true;
    if (detail?.embedUrl) playingUrl = detail.embedUrl;
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

  /** Back to rest at the speed the finger left it (towards rest, in pixels per millisecond). */
  function settle(velocity: number): void {
    settleMs = settleDuration(offset, velocity, panelDuration());
    settleCurve = settleEasing(offset, velocity, settleMs);
    offset = 0;
  }

  /**
   * Swipes to the next or previous file: the shown one follows the finger sideways. Vertical
   * movement and pinching stay with the browser, and touches on a video player are its own.
   */
  function swipeArea(area: HTMLElement): () => void {
    function start(event: TouchEvent): void {
      const target = event.target;
      if (
        event.touches.length !== 1 ||
        (target instanceof Element && target.closest('video, iframe'))
      ) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      swipe = {
        track: startTrack(touch.clientX, touch.clientY, event.timeStamp),
        axis: null,
        width: area.clientWidth,
      };
    }

    function move(event: TouchEvent): void {
      if (!swipe) return;
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - swipe.track.startX;
      const dy = touch.clientY - swipe.track.startY;
      if (swipe.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          swipe = null;
          return;
        }
        swipe.axis = 'x';
      }
      if (event.cancelable) event.preventDefault();
      moveTrack(swipe.track, touch.clientX, touch.clientY, event.timeStamp);
      // At the first or last file, the view only gives a little
      const blocked = dx > 0 ? index === 0 : index === files.length - 1;
      settleMs = 0;
      offset = blocked ? Math.sign(dx) * rubberBand(Math.abs(dx)) : dx;
    }

    function end(event: TouchEvent): void {
      const ended = swipe;
      swipe = null;
      if (!ended || ended.axis !== 'x') return;
      const dx = ended.track.lastX - ended.track.startX;
      const velocity = releaseVelocity(ended.track, 'x', event.timeStamp);
      const step = dx < 0 ? 1 : -1;
      const next = index + step;
      // Distance and speed in the direction of the swipe
      if (
        next >= 0 &&
        next < files.length &&
        commits(-step * dx, -step * velocity, ended.width / 4)
      ) {
        // The new file appears in place; it does not slide in from the old position
        settleMs = 0;
        offset = 0;
        go(step);
      } else {
        settle(step * velocity);
      }
    }

    function cancel(): void {
      if (swipe?.axis === 'x') settle(0);
      swipe = null;
    }

    area.addEventListener('touchstart', start, { passive: true });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', cancel);
    return () => {
      area.removeEventListener('touchstart', start);
      area.removeEventListener('touchmove', move);
      area.removeEventListener('touchend', end);
      area.removeEventListener('touchcancel', cancel);
    };
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
        class="swipe-area relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        role="group"
        aria-label="Wische zur Seite für das nächste oder vorherige Foto"
        {@attach swipeArea}
      >
        <div
          class="swipe-media flex h-full w-full items-center justify-center"
          style:translate={offset ? `${offset}px 0` : undefined}
          style:transition={settleTransition('translate', settleMs, settleCurve)}
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
              onloadedmetadata={(event) => checkPicture(event.currentTarget)}
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
        </div>
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
        {:else if file.kind === 'video' && soundOnly && playingUrl}
          <p class="text-sm" role="status">
            Dein Browser kann von diesem Video nur den Ton abspielen. Es läuft deshalb im Player von
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
  /* Sideways movement is the swipe's; scrolling up and down and zooming stay with the browser */
  .swipe-area {
    touch-action: pan-y pinch-zoom;
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
