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
  import {
    NO_ZOOM,
    ZOOM_SNAP,
    ZOOM_STEP,
    clampPan,
    containedSize,
    isDoubleTap,
    isZoomed,
    panLimit,
    pinchZoom,
    zoomAround,
    type Point,
    type Tap,
    type Zoom,
  } from '../../lib/zoom';
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
  /** Distance the shown file follows the finger, sideways and down; 0 at rest. */
  let offset = $state(0);
  let offsetY = $state(0);
  /** Height of the photo area when the finger started pulling down, for the fading background. */
  let dropHeight = $state(0);
  /** Duration of the movement back to rest; 0 while the finger moves and for a change of photo. */
  let settleMs = $state(0);
  /** Curve of the settle back, starting at the speed of the released finger. */
  let settleCurve = $state('var(--motion-enter)');
  /** Scale and shift of the shown photo; only photos with a picture zoom. */
  let zoom = $state.raw<Zoom>(NO_ZOOM);
  /** Duration of a zoom by double tap or button, and of the return inside the edges; 0 while fingers move. */
  let zoomMs = $state(0);
  let image = $state<HTMLImageElement | null>(null);

  const file = $derived(files[index]);
  const detail = $derived.by(() => {
    const entry = file ? details[file.id] : undefined;
    return entry && now - entry.loadedAt < DETAIL_MAX_AGE_MS ? entry.data : undefined;
  });
  const downloadUrl = $derived(detail?.downloadUrl ?? null);
  const zoomable = $derived(
    file !== undefined && file.kind !== 'video' && Boolean(file.thumbnailUrl || detail?.imageUrl)
  );
  const zoomed = $derived(isZoomed(zoom));
  /** The dark background fades as the photo is pulled down, to show that letting go closes it. */
  const dim = $derived(
    offsetY > 0 && dropHeight > 0 ? 1 - 0.8 * Math.min(1, offsetY / (dropHeight / 2)) : 1
  );
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
    // The view is removed with the dialog still open, so the browser does not return focus itself
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => {
      clearInterval(timer);
      dialog?.close();
      queueMicrotask(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
      });
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
        zoomMs = 0;
        zoom = NO_ZOOM;
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

  /** Share of the view that one arrow key moves a zoomed photo. */
  const KEY_PAN = 0.15;
  const KEY_DIRECTION: Record<string, Point> = {
    ArrowLeft: { x: 1, y: 0 },
    ArrowRight: { x: -1, y: 0 },
    ArrowUp: { x: 0, y: 1 },
    ArrowDown: { x: 0, y: -1 },
  };

  function onkeydown(event: KeyboardEvent): void {
    // The arrow keys of a focused video player seek within the video
    if (event.target instanceof HTMLVideoElement || event.defaultPrevented) return;
    const direction = KEY_DIRECTION[event.key];
    // While zoomed the arrow keys move the photo, so every edge can be reached without a finger
    if (zoomed && photoArea && direction) {
      event.preventDefault();
      const next = {
        ...zoom,
        x: zoom.x + direction.x * photoArea.clientWidth * KEY_PAN,
        y: zoom.y + direction.y * photoArea.clientHeight * KEY_PAN,
      };
      animateZoom(keepInside(next, photoArea));
      return;
    }
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
  }

  /** Back to rest at the speed the finger left it (towards rest, in pixels per millisecond). */
  function settle(velocity: number): void {
    const distance = Math.abs(offset) + Math.abs(offsetY);
    settleMs = settleDuration(distance, velocity, panelDuration());
    settleCurve = settleEasing(distance, velocity, settleMs);
    offset = 0;
    offsetY = 0;
  }

  /** Changes the zoom with the shared movement; with Reduced Motion it jumps. */
  function animateZoom(next: Zoom): void {
    zoomMs = panelDuration();
    zoom = next;
  }

  /** Size of the picture inside the image box, without the empty bands around it. */
  function pictureSize(): { width: number; height: number } {
    const box = { width: image?.offsetWidth ?? 0, height: image?.offsetHeight ?? 0 };
    const width = image?.naturalWidth || file?.width || box.width;
    const height = image?.naturalHeight || file?.height || box.height;
    return containedSize(box, height > 0 ? width / height : 0);
  }

  /** Keeps the zoomed photo inside its edges; with `give` it yields a little past them. */
  function keepInside(next: Zoom, area: HTMLElement, give?: (overshoot: number) => number): Zoom {
    const view = { width: area.clientWidth, height: area.clientHeight };
    return clampPan(next, panLimit(pictureSize(), view, next.scale), give);
  }

  /** Between the whole photo and 2.5×, around `focus` (relative to the centre of the area). */
  /**
   * The end of every zoom gesture, also of a pinch that went on as a one-finger pan: a scale just
   * above 1 returns to the whole photo, any other is kept inside the edges.
   */
  function finishZoom(area: HTMLElement): void {
    animateZoom(zoom.scale < ZOOM_SNAP ? NO_ZOOM : keepInside(zoom, area));
  }

  function toggleZoom(area: HTMLElement, focus: Point): void {
    if (zoomed) animateZoom(NO_ZOOM);
    else animateZoom(keepInside(zoomAround(NO_ZOOM, ZOOM_STEP, focus), area));
  }

  let photoArea: HTMLElement | null = null;

  /**
   * Gestures on the shown file: sideways for the next or previous file, down to close, and on
   * photos a double tap or two fingers to zoom, one finger to move the zoomed photo. Touches on
   * a video player are its own.
   */
  function swipeArea(area: HTMLElement): () => void {
    type Gesture =
      | {
          kind: 'swipe';
          track: SwipeTrack;
          axis: 'x' | 'y' | null;
          width: number;
          height: number;
          tap: boolean;
        }
      | { kind: 'pan'; track: SwipeTrack; from: Zoom; moved: boolean; tap: boolean }
      | { kind: 'pinch'; from: Zoom; mid: Point; distance: number };
    let gesture: Gesture | null = null;
    /** The last single tap, to recognise a second one as a double tap. */
    let lastTap: Tap | null = null;
    photoArea = area;

    /** A point on the screen relative to the centre of the area. */
    function relative(x: number, y: number): Point {
      const rect = area.getBoundingClientRect();
      return { x: x - rect.left - rect.width / 2, y: y - rect.top - rect.height / 2 };
    }

    function fingers(touches: TouchList): { mid: Point; distance: number } {
      const [a, b] = [touches[0], touches[1]];
      return {
        mid: relative((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      };
    }

    function startPan(touch: Touch, time: number, tap: boolean): void {
      gesture = {
        kind: 'pan',
        track: startTrack(touch.clientX, touch.clientY, time),
        from: zoom,
        moved: false,
        tap,
      };
    }

    function start(event: TouchEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('video, iframe')) {
        cancel();
        return;
      }
      if (event.touches.length === 2 && zoomable) {
        // A second finger turns any swipe into a pinch
        if (gesture?.kind === 'swipe' && gesture.axis) settle(0);
        lastTap = null;
        zoomMs = 0;
        gesture = { kind: 'pinch', from: zoom, ...fingers(event.touches) };
        return;
      }
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      // Taps on the buttons stay single taps
      const tap = zoomable && !target?.closest('button, a');
      if (zoomed) {
        startPan(touch, event.timeStamp, tap);
        return;
      }
      gesture = {
        kind: 'swipe',
        track: startTrack(touch.clientX, touch.clientY, event.timeStamp),
        axis: null,
        width: area.clientWidth,
        height: area.clientHeight,
        tap,
      };
    }

    function move(event: TouchEvent): void {
      if (!gesture) return;
      if (gesture.kind === 'pinch') {
        if (event.touches.length < 2) return;
        if (event.cancelable) event.preventDefault();
        const now = fingers(event.touches);
        const next = pinchZoom(gesture.from, gesture.mid, gesture.distance, now.mid, now.distance);
        zoom = keepInside(next, area, rubberBand);
        return;
      }
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.track.startX;
      const dy = touch.clientY - gesture.track.startY;
      if (gesture.kind === 'pan') {
        if (!gesture.moved) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START) return;
          gesture.moved = true;
        }
        if (event.cancelable) event.preventDefault();
        moveTrack(gesture.track, touch.clientX, touch.clientY, event.timeStamp);
        zoomMs = 0;
        zoom = keepInside(
          { ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy },
          area,
          rubberBand
        );
        return;
      }
      if (gesture.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START) return;
        // Decided once per touch: sideways changes the photo, vertically it closes
        gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (gesture.axis === 'y') dropHeight = gesture.height;
      }
      if (event.cancelable) event.preventDefault();
      moveTrack(gesture.track, touch.clientX, touch.clientY, event.timeStamp);
      settleMs = 0;
      if (gesture.axis === 'y') {
        // Upwards the photo only gives a little
        offsetY = dy > 0 ? dy : -rubberBand(-dy);
        return;
      }
      // At the first or last file, the view only gives a little
      const blocked = dx > 0 ? index === 0 : index === files.length - 1;
      offset = blocked ? Math.sign(dx) * rubberBand(Math.abs(dx)) : dx;
    }

    function end(event: TouchEvent): void {
      const ended = gesture;
      gesture = null;
      if (!ended) return;
      if (ended.kind === 'pinch') {
        if (event.touches.length === 1 && zoomed) {
          // The finger left on the photo goes on moving it
          startPan(event.touches[0], event.timeStamp, false);
          return;
        }
        finishZoom(area);
        return;
      }
      if (event.touches.length > 0) return;
      const tapped = ended.kind === 'pan' ? !ended.moved : ended.axis === null;
      if (tapped) {
        // The finger left over from a pinch: its release ends the zoom gesture
        if (!ended.tap) {
          finishZoom(area);
          return;
        }
        const tap = { x: ended.track.lastX, y: ended.track.lastY, time: event.timeStamp };
        if (isDoubleTap(lastTap, tap)) {
          lastTap = null;
          if (event.cancelable) event.preventDefault();
          toggleZoom(area, relative(tap.x, tap.y));
        } else {
          lastTap = tap;
        }
        return;
      }
      lastTap = null;
      if (ended.kind === 'pan') {
        finishZoom(area);
        return;
      }
      if (ended.axis === 'y') {
        const dy = ended.track.lastY - ended.track.startY;
        const velocity = releaseVelocity(ended.track, 'y', event.timeStamp);
        if (commits(dy, velocity, ended.height / 5)) {
          // Closes at once, like the close button; the view does not wait for the photo
          settleMs = 0;
          offsetY = 0;
          onclose();
        } else {
          settle(-velocity);
        }
        return;
      }
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
      if (gesture?.kind === 'swipe' && gesture.axis) settle(0);
      else if (gesture && gesture.kind !== 'swipe') animateZoom(keepInside(zoom, area));
      gesture = null;
    }

    /** With a mouse, the zoomed photo moves by dragging. */
    let drag: { x: number; y: number; from: Zoom } | null = null;
    function pointerdown(event: PointerEvent): void {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !zoomed) return;
      if (event.target instanceof Element && event.target.closest('button, a')) return;
      event.preventDefault();
      area.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, from: zoom };
      zoomMs = 0;
    }
    function pointermove(event: PointerEvent): void {
      if (!drag) return;
      const { from } = drag;
      zoom = keepInside(
        { ...from, x: from.x + event.clientX - drag.x, y: from.y + event.clientY - drag.y },
        area
      );
    }
    function pointerup(): void {
      drag = null;
    }

    area.addEventListener('touchstart', start, { passive: true });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', cancel);
    area.addEventListener('pointerdown', pointerdown);
    area.addEventListener('pointermove', pointermove);
    area.addEventListener('pointerup', pointerup);
    area.addEventListener('pointercancel', pointerup);
    return () => {
      photoArea = null;
      area.removeEventListener('touchstart', start);
      area.removeEventListener('touchmove', move);
      area.removeEventListener('touchend', end);
      area.removeEventListener('touchcancel', cancel);
      area.removeEventListener('pointerdown', pointerdown);
      area.removeEventListener('pointermove', pointermove);
      area.removeEventListener('pointerup', pointerup);
      area.removeEventListener('pointercancel', pointerup);
    };
  }
</script>

<dialog
  bind:this={dialog}
  class="foto-detail m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
  aria-labelledby={`${id}-title`}
  style:--foto-dim={dim}
  style:transition={settleTransition('--foto-dim', settleMs, settleCurve)}
  oncancel={(event) => {
    event.preventDefault();
    onclose();
  }}
  {onkeydown}
>
  {#if file}
    <div class="flex h-full flex-col text-white">
      <div class="viewer-bar flex items-center gap-2 px-2 py-1">
        <p class="shrink-0 px-2 text-sm tabular-nums" aria-live="polite">
          {index + 1} von {files.length}
        </p>
        <h2 id={`${id}-title`} class="min-w-0 flex-1 truncate text-sm font-semibold">
          {file.name}
        </h2>
        {#if zoomable}
          <button
            type="button"
            class="viewer-button"
            aria-label={zoomed ? 'Verkleinern' : 'Vergrößern'}
            title={zoomed ? 'Verkleinern' : 'Vergrößern'}
            onclick={() => {
              if (photoArea) toggleZoom(photoArea, { x: 0, y: 0 });
            }}
          >
            <svg
              aria-hidden="true"
              class="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              ><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20M8 10.5h5" /><path
                class={['zoom-bar', zoomed && 'zoomed']}
                d="M10.5 8v5"
              /></svg
            >
          </button>
        {/if}
        <!-- svelte-ignore a11y_autofocus -->
        <button
          type="button"
          class="viewer-button"
          autofocus
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
        class={[
          'swipe-area relative flex min-h-0 flex-1 items-center justify-center overflow-hidden',
          zoomable && 'zoomable',
          zoomed && 'zoomed',
        ]}
        role="group"
        aria-label={zoomed
          ? 'Vergrößertes Foto: Ziehe es mit einem Finger oder verschiebe es mit den Pfeiltasten. Doppelt tippen verkleinert es.'
          : `Wische zur Seite für das nächste oder vorherige Foto, nach unten zum Schließen.${zoomable ? ' Doppelt tippen vergrößert das Foto.' : ''}`}
        {@attach swipeArea}
      >
        <div
          class="swipe-media flex h-full w-full items-center justify-center"
          style:translate={offset || offsetY ? `${offset}px ${offsetY}px` : undefined}
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
              bind:this={image}
              src={large && largeLoaded === large ? large : (file.thumbnailUrl ?? large)}
              alt={file.kind === 'video' ? `Vorschau des Videos ${file.name}` : file.name}
              width={file.width ?? 1600}
              height={file.height ?? 1200}
              class="max-h-full max-w-full object-contain"
              draggable="false"
              style:transform={zoomed || zoom.x || zoom.y
                ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`
                : undefined}
              style:transition={settleTransition('transform', zoomMs)}
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
            <p class="max-w-sm px-6 text-center">Keine Vorschau für „{file.name}“.</p>
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

      <div class="viewer-bar space-y-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p class="text-sm text-white/80">{meta}</p>
        {#if file.kind === 'video' && (playingUrl === '' || (videoFailed && detail && !detail.embedUrl))}
          <p class="text-sm">Dieses Video lässt sich hier nicht abspielen.</p>
        {:else if file.kind === 'video' && videoSrc && !videoFailed && !playingUrl && detail?.embedUrl}
          <button
            type="button"
            class="min-h-11 text-sm text-white/80 underline underline-offset-2"
            onclick={() => (playingUrl = detail?.embedUrl ?? '')}
            >Im Player von SharePoint abspielen</button
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
  /*
   * Registered, so the background can return with the photo when it settles back; the backdrop
   * inherits it from the dialog.
   */
  @property --foto-dim {
    syntax: '<number>';
    inherits: true;
    initial-value: 1;
  }
  .foto-detail::backdrop {
    background: rgb(0 0 0 / var(--foto-dim, 1));
  }
  .foto-detail[open] {
    display: block;
    background: rgb(0 0 0 / var(--foto-dim, 1));
  }
  .viewer-bar {
    opacity: var(--foto-dim, 1);
  }
  /*
   * Sideways and down are the swipe's. Around a video, scrolling and zooming stay with the
   * browser as before. On a photo every finger movement is ours: the page must not zoom or
   * scroll while two fingers zoom the photo or one pulls it down.
   */
  .swipe-area {
    touch-action: pan-y pinch-zoom;
  }
  .swipe-area.zoomable {
    touch-action: none;
  }
  /* The upright bar of the plus folds into the minus while zoomed, and unfolds again */
  .zoom-bar {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform var(--motion-quick) var(--motion-move);
  }
  .zoom-bar.zoomed {
    transform: scaleY(0);
  }
  .swipe-area.zoomed {
    cursor: grab;
  }
  .viewer-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: calc(var(--spacing) * 11);
    min-height: calc(var(--spacing) * 11);
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
