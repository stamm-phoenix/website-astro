<script lang="ts">
  import { untrack } from 'svelte';
  import {
    getInstagramImageUrl,
    getInstagramVideoUrl,
    shouldConfirmInstagram,
    type InstagramConsentRequest,
  } from '../lib/instagramStore.svelte';
  import {
    SWIPE_START,
    commits,
    moveTrack,
    panelDuration,
    releaseVelocity,
    settleDuration,
    settleEasing,
    settleTransition,
    startTrack,
    type SwipeTrack,
  } from '../lib/swipe';
  import type { InstagramPost } from '../lib/types';

  interface Props {
    post: InstagramPost;
    alt: string;
    /**
     * `tile`: preview in a card (fixed aspect, advances by itself, no controls).
     * `modal`: large in the post dialog (natural aspect, arrows, video can be played).
     */
    variant?: 'tile' | 'modal';
    /** Added to the interval, so the carousels of different tiles do not change in sync */
    autoAdvanceOffset?: number;
    /** Aspect of the tile, e.g. `aspect-[4/3]` */
    aspectClass?: string;
    /** Asks the visitor before the video is loaded from Instagram; without it, it plays right away */
    onconsent?: (request: InstagramConsentRequest) => void;
    /** Width / height of the first image, known once it has loaded (the dialog adapts to it) */
    ratio?: number;
  }
  let {
    post,
    alt,
    variant = 'tile',
    autoAdvanceOffset = 0,
    aspectClass = 'aspect-square',
    onconsent,
    ratio = $bindable(4 / 5),
  }: Props = $props();

  const AUTO_ADVANCE_MS = 6000;

  const isModal = $derived(variant === 'modal');
  const size = $derived(isModal ? 'large' : 'small');

  let container = $state<HTMLDivElement>();
  let index = $state(0);
  // Images are proxied by our API and can take a moment, so they only show once loaded
  let loaded = $state<Set<number>>(new Set());
  let visible = $state(false);
  let reducedMotion = $state(false);
  /** Set once someone browses themselves; from then on the carousel no longer advances */
  let browsed = $state(false);
  /** Bumped to reschedule the next step while the tile is hovered or focused */
  let pauseTick = $state(0);

  /** Image that was requested but is still loading; shown in the counter right away */
  let target = $state<number | null>(null);

  const isCarousel = $derived(post.imageCount > 1);
  /**
   * Whether the images sit side by side in a strip: always in the dialog, on a tile from the
   * first swipe on. Before that, a tile cross-fades as it advances by itself.
   */
  const stripMode = $derived(isCarousel && (isModal || browsed));
  const canPlay = $derived(isModal && post.mediaType === 'VIDEO' && post.hasVideo);
  /** The video is only requested (from Instagram) once someone clicks play */
  let playing = $state(false);
  let video = $state<HTMLVideoElement>();

  // The play button disappears, so keyboard focus moves on to the player
  $effect(() => {
    // After the consent dialog has closed and returned focus to where it came from
    if (playing) setTimeout(() => video?.focus());
  });

  function play(): void {
    if (onconsent && shouldConfirmInstagram('video')) {
      onconsent({ kind: 'video', onconfirm: () => (playing = true) });
    } else {
      playing = true;
    }
  }

  // Not reactive on purpose: only avoids loading the same image twice
  const pendingLoads: Record<number, Promise<void>> = {};

  function markLoaded(i: number, image?: HTMLImageElement): void {
    if (i === 0 && image?.naturalWidth && image.naturalHeight) {
      ratio = image.naturalWidth / image.naturalHeight;
    }
    if (!loaded.has(i)) loaded = new Set([...loaded, i]);
  }

  function handleImageLoad(i: number, event: Event): void {
    const image = event.currentTarget;
    markLoaded(i, image instanceof HTMLImageElement ? image : undefined);
  }

  /** Loads an image in the background and resolves once it is ready (or failed). */
  function preload(i: number): Promise<void> {
    if (loaded.has(i)) return Promise.resolve();
    let pending = pendingLoads[i];
    if (!pending) {
      pending = new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          markLoaded(i);
          resolve();
        };
        img.src = getInstagramImageUrl(post.id, i, size);
      });
      pendingLoads[i] = pending;
    }
    return pending;
  }

  /** Switches to image i once it is loaded; the most recent request wins. */
  async function show(i: number): Promise<void> {
    const next = (i + post.imageCount) % post.imageCount;
    target = next;
    await preload(next);
    if (target === next) {
      index = next;
      target = null;
    }
  }

  /*
   * In the strip (dialog, and a tile once swiped) the images sit side by side. Every image has a
   * fixed place in it (`position`, counted without wrapping), and the strip is moved so the
   * current place is in view. Changing the place therefore slides the strip from wherever it is,
   * and the image index wraps around (`position` modulo the number of images).
   */
  let strip = $state<HTMLDivElement>();
  /** Place of the current image in the strip; may run past the ends, the index wraps. */
  let position = $state(0);
  /** Horizontal distance the strip follows the finger in pixels; 0 at rest. */
  let offset = $state(0);
  /** Duration of the movement to the current place; 0 while the finger moves. */
  let settleMs = $state(0);
  /** Curve of that movement, starting at the speed of the released finger. */
  let settleCurve = $state('var(--motion-enter)');
  /**
   * Places that are rendered: the current one and its neighbours, plus the ones a running
   * movement still passes. Only the rendering uses it; index and counter change right away.
   */
  let span = $state({ low: -1, high: 1 });
  const places = $derived(Array.from({ length: span.high - span.low + 1 }, (_, i) => span.low + i));

  const wrap = (i: number): number => ((i % post.imageCount) + post.imageCount) % post.imageCount;

  /** Moves to the place `step` away and slides the strip there over `duration` ms. */
  function slide(step: number, duration: number, curve: string): void {
    browsed = true;
    position += step;
    index = wrap(position);
    offset = 0;
    settleMs = duration;
    settleCurve = curve;
    span =
      duration > 0
        ? { low: Math.min(span.low, position - 1), high: Math.max(span.high, position + 1) }
        : { low: position - 1, high: position + 1 };
  }

  /** Arrows and keys (dialog only): the same movement as a release without speed. */
  function browse(step: number): void {
    slide(step, panelDuration(), 'var(--motion-enter)');
  }

  /**
   * A tile switches to the strip when a swipe starts: the strip begins at the image shown, and
   * an image the tile was still loading to advance to no longer replaces it.
   */
  function enterStrip(): void {
    if (stripMode) return;
    position = index;
    span = { low: index - 1, high: index + 1 };
    offset = 0;
    settleMs = 0;
    target = null;
    browsed = true;
  }

  /** Once the strip has arrived, only the current image and its neighbours stay rendered. */
  function handleSettled(event: TransitionEvent): void {
    if (event.target !== strip || event.propertyName !== 'translate') return;
    span = { low: position - 1, high: position + 1 };
  }

  /** The touch being followed, and whether it moves sideways (`x`) or is left to the browser. */
  let swipe: { track: SwipeTrack; axis: 'x' | null; width: number; base: number } | null = null;
  /** A finger rests on the images; a tile does not advance meanwhile. Not reactive on purpose. */
  let fingerDown = false;
  /** Within a link (the card), a click this late after a swipe belongs to the swipe. */
  const SWIPE_CLICK_MS = 400;

  /**
   * A sideways swipe browses like the arrows of the dialog, in the dialog and on a tile. The
   * strip follows the finger, so the neighbouring image slides in from the edge; on release it
   * continues to that image or returns. Vertical movement and pinching stay with the browser.
   */
  function swipeArea(area: HTMLElement): () => void {
    /**
     * Set when a swipe ends: the click some browsers (Safari) still send for the touch would
     * otherwise open the post from a card. Cleared after a moment or by the next touch.
     */
    let swallowClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    function guardClick(event: MouseEvent): void {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function holdClick(): void {
      swallowClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => (swallowClick = false), SWIPE_CLICK_MS);
    }

    /** Where the strip is drawn right now, relative to the current place (also mid-movement). */
    function shownOffset(width: number): number {
      if (!strip) return offset;
      const shift = strip.getBoundingClientRect().left - area.getBoundingClientRect().left;
      return shift + position * width;
    }

    function settle(distance: number, velocity: number): void {
      settleMs = settleDuration(distance, velocity, panelDuration());
      settleCurve = settleEasing(distance, velocity, settleMs);
      offset = 0;
    }

    function start(event: TouchEvent): void {
      swallowClick = false;
      fingerDown = true;
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      swipe = {
        track: startTrack(touch.clientX, touch.clientY, event.timeStamp),
        axis: null,
        width: area.clientWidth,
        base: 0,
      };
      // A tile loads its images one after another; the neighbours a swipe reveals come first
      if (!isModal) for (const step of [1, -1]) void preload(wrap(index + step));
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
        enterStrip();
        // Continues from where a running movement has got to, without a jump
        swipe.base = shownOffset(swipe.width) - dx;
      }
      if (event.cancelable) event.preventDefault();
      moveTrack(swipe.track, touch.clientX, touch.clientY, event.timeStamp);
      settleMs = 0;
      // At most one image to each side, so no empty place comes into view
      offset = Math.max(-swipe.width, Math.min(swipe.width, swipe.base + dx));
    }

    function end(event: TouchEvent): void {
      const ended = swipe;
      swipe = null;
      fingerDown = event.touches.length > 0;
      if (!ended || ended.axis !== 'x') return;
      holdClick();
      const velocity = releaseVelocity(ended.track, 'x', event.timeStamp);
      const dragged = offset;
      const step = dragged < 0 || (dragged === 0 && velocity < 0) ? 1 : -1;
      if (commits(-step * dragged, -step * velocity, ended.width / 4)) {
        // Index and counter change now; the strip continues from where the finger left it
        const remaining = ended.width - Math.abs(dragged);
        const duration = settleDuration(remaining, -step * velocity, panelDuration());
        slide(step, duration, settleEasing(remaining, -step * velocity, duration));
      } else {
        settle(dragged, step * velocity);
      }
    }

    function cancel(): void {
      if (swipe?.axis === 'x') settle(offset, 0);
      swipe = null;
    }

    function touchCancel(): void {
      fingerDown = false;
      cancel();
    }

    area.addEventListener('touchstart', start, { passive: true });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', touchCancel);
    area.addEventListener('click', guardClick, true);
    return () => {
      clearTimeout(clickTimer);
      area.removeEventListener('touchstart', start);
      area.removeEventListener('touchmove', move);
      area.removeEventListener('touchend', end);
      area.removeEventListener('touchcancel', touchCancel);
      area.removeEventListener('click', guardClick, true);
    };
  }

  $effect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = media.matches;
    const onChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  });

  $effect(() => {
    if (!container || !isCarousel) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  // In the dialog, the arrow keys browse (unless a consent dialog lies on top)
  $effect(() => {
    if (!isModal || !isCarousel || !container) return;
    const dialog = container.closest('dialog');
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!(event.target instanceof Node) || !dialog?.contains(event.target)) return;
      event.preventDefault();
      browse(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A tile that advances by itself prepares only the next image, once it is visible and the first
  // one is there; the rest follows with each step, and a swipe loads its neighbours itself
  $effect(() => {
    if (isModal || !isCarousel || !visible || browsed || reducedMotion || !loaded.has(0)) return;
    const next = wrap(index + 1);
    void untrack(() => preload(next));
  });

  // In the strip, the current image and both neighbours are loaded, so the image a swipe
  // reveals is usually there while the finger moves; nothing further ahead
  $effect(() => {
    if (!stripMode) return;
    for (const i of [index, wrap(index + 1), wrap(index - 1)]) {
      if (i !== 0) void untrack(() => preload(i));
    }
  });

  // Tiles advance slowly, but not while hovered, focused or touched, and no longer once
  // swiped; the dialog only on request
  $effect(() => {
    if (isModal || !isCarousel || !visible || browsed || reducedMotion) return;
    const current = index;
    void pauseTick;
    const timer = setTimeout(() => {
      const tile = container?.closest('li') ?? container;
      if (fingerDown || tile?.matches(':hover, :focus-within')) pauseTick++;
      else void show(current + 1);
    }, AUTO_ADVANCE_MS + autoAdvanceOffset);
    return () => clearTimeout(timer);
  });
</script>

<div
  bind:this={container}
  class="relative overflow-hidden {isModal
    ? 'modal-media bg-neutral-900'
    : `${aspectClass} bg-neutral-100`}"
  class:skeleton-element={!loaded.has(0) && !stripMode}
  class:swipe-area={isCarousel}
  style:--ratio={isModal ? ratio : undefined}
  {@attach isCarousel ? swipeArea : undefined}
>
  {#if stripMode}
    <!-- The images side by side; the strip moves, the controls stay in place -->
    <div
      bind:this={strip}
      class="carousel-strip absolute inset-0"
      class:tile-media={!isModal}
      style:translate="calc({-position * 100}% + {offset}px) 0"
      style:transition={settleTransition('translate', settleMs, settleCurve)}
      ontransitionend={handleSettled}
    >
      {#each places as place (place)}
        {@const i = wrap(place)}
        <div
          class="carousel-slot absolute inset-y-0 w-full"
          class:skeleton-element={!loaded.has(i)}
          style:left="{place * 100}%"
          data-image={i}
          aria-hidden={place === position ? undefined : 'true'}
        >
          {#if i === 0 || loaded.has(i)}
            <img
              src={getInstagramImageUrl(post.id, i, size)}
              alt={place === position ? alt : ''}
              width="640"
              height="640"
              decoding="async"
              class="post-image absolute inset-0 h-full w-full {isModal
                ? 'object-contain'
                : 'object-cover'}"
              class:post-image-loaded={loaded.has(i)}
              onload={(event) => handleImageLoad(i, event)}
              onerror={() => markLoaded(i)}
            />
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="absolute inset-0" class:tile-media={!isModal}>
      {#each Array.from({ length: post.imageCount }, (_, i) => i) as i (i)}
        {#if i === 0 || loaded.has(i)}
          <img
            src={getInstagramImageUrl(post.id, i, size)}
            alt={i === index ? alt : ''}
            aria-hidden={i === index ? undefined : 'true'}
            width="640"
            height="640"
            loading={i === 0 && !isModal ? 'lazy' : undefined}
            decoding="async"
            class="post-image absolute inset-0 h-full w-full {isModal
              ? 'object-contain'
              : 'object-cover'}"
            class:post-image-loaded={loaded.has(i)}
            class:post-image-hidden={i !== index}
            onload={(event) => handleImageLoad(i, event)}
            onerror={() => markLoaded(i)}
          />
        {/if}
      {/each}
    </div>
  {/if}

  {#if canPlay && playing}
    <!-- Instagram provides no captions -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      src={getInstagramVideoUrl(post.id)}
      poster={getInstagramImageUrl(post.id, 0, size)}
      class="absolute inset-0 z-10 h-full w-full object-contain"
      controls
      autoplay
      playsinline
    ></video>
  {:else if canPlay}
    <button
      type="button"
      class="play-button"
      aria-label="Video abspielen (wird von Instagram geladen)"
      onclick={play}
    >
      <span class="play-circle">
        <svg class="size-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"
          />
        </svg>
      </span>
      <span class="play-hint" aria-hidden="true">Video wird von Instagram geladen</span>
    </button>
  {:else if isModal && post.mediaType === 'VIDEO'}
    <!-- E.g. reels with licensed music: Instagram does not provide the video -->
    <p class="play-hint absolute inset-x-0 bottom-4 mx-auto w-fit">
      Dieses Video gibt es nur auf Instagram
    </p>
  {:else if post.mediaType === 'VIDEO'}
    <!-- Marks reels on the tile -->
    <span
      class="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-action/80 text-on-action"
      aria-hidden="true"
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"
        />
      </svg>
    </span>
  {/if}

  {#if isCarousel}
    {#if isModal}
      <!-- Plain counter; on the tile, the dots alone show the position -->
      <span
        class="absolute top-3 right-3 flex items-center gap-1.5 rounded-sm bg-[var(--color-dpsg-blue)]/75 px-1.5 py-0.5 text-xs text-white tabular-nums"
        aria-hidden="true"
      >
        {#if target !== null || !loaded.has(index)}
          <!-- The requested image is still loading -->
          <span class="spinner"></span>
        {/if}
        {(target ?? index) + 1} / {post.imageCount}
      </span>

      {#if browsed}
        <span class="sr-only" aria-live="polite">Bild {index + 1} von {post.imageCount}</span>
      {/if}
      <button
        type="button"
        class="nav-button left-3"
        aria-label="Vorheriges Bild"
        onclick={() => browse(-1)}
      >
        <svg
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        class="nav-button right-3"
        aria-label="Nächstes Bild"
        onclick={() => browse(1)}
      >
        <svg
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
        </svg>
      </button>
    {/if}

    <div class="absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden="true">
      {#each Array.from({ length: post.imageCount }, (_, i) => i) as i (i)}
        <span class="dot" class:dot-active={i === (target ?? index)}></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  /*
   * In the dialog: exactly the shape of the image, as large as the space allows. The dialog sets
   * the available space via --media-max-width and --media-max-height.
   */
  .modal-media {
    aspect-ratio: var(--ratio);
    width: min(var(--media-max-width, 100vw), calc(var(--media-max-height, 80dvh) * var(--ratio)));
    margin-inline: auto;
  }

  /* Sideways movement is the swipe's; scrolling up and down and zooming stay with the browser */
  .swipe-area {
    touch-action: pan-y pinch-zoom;
  }

  /*
   * On a tile, touches and clicks land on the area itself: the images are swapped for the strip
   * when a swipe starts, and a touch whose element left the page would no longer reach the
   * swipe. The click then goes on to the card's link as before.
   */
  .tile-media {
    pointer-events: none;
  }

  /* Fades in once loaded */
  .post-image {
    opacity: 0;
    transition: opacity 0.4s ease-out;
  }

  .post-image-loaded {
    opacity: 1;
  }

  /* The outgoing image stays until the incoming one has faded in */
  .post-image-hidden {
    opacity: 0;
    transition-delay: 0.4s;
  }

  .nav-button {
    position: absolute;
    top: 50%;
    z-index: 10;
    display: flex;
    width: 2.5rem;
    height: 2.5rem;
    translate: 0 -50%;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-neutral-300);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-brand-900);
  }

  .nav-button:hover {
    background: var(--color-surface);
  }

  .nav-button:active {
    background: var(--color-neutral-200);
  }

  .nav-button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.55);
    box-shadow: 0 0 2px rgb(0 0 0 / 0.4);
    transition: background-color 0.3s ease;
  }

  .dot-active {
    background: white;
  }

  .play-button {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .play-circle {
    display: flex;
    width: 4rem;
    height: 4rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: var(--color-surface);
    color: var(--color-brand-900);
    transition: background-color 0.2s ease;
  }

  .play-button:hover .play-circle {
    background: var(--color-surface);
  }

  .play-button:active .play-circle {
    background: var(--color-neutral-200);
  }

  .play-button:focus-visible {
    outline: none;
  }

  .play-button:focus-visible .play-circle {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  .play-hint {
    border-radius: var(--radius-sm);
    background: rgb(0 48 86 / 0.85);
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    color: white;
  }

  .spinner {
    width: 0.625rem;
    height: 0.625rem;
    border: 2px solid rgb(255 255 255 / 0.35);
    border-top-color: white;
    border-radius: 9999px;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
</style>
