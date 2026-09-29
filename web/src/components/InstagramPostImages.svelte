<script lang="ts">
  import { untrack } from 'svelte';
  import { getInstagramImageUrl, getInstagramVideoUrl } from '../lib/instagramStore.svelte';
  import type { InstagramPost } from '../lib/types';

  interface Props {
    post: InstagramPost;
    alt: string;
    /** Added to the interval, so the carousels of different tiles do not change in sync */
    autoAdvanceOffset?: number;
  }
  let { post, alt, autoAdvanceOffset = 0 }: Props = $props();

  const AUTO_ADVANCE_MS = 6000;

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
  const canPlay = $derived(post.mediaType === 'VIDEO' && post.hasVideo);
  /** The video is only requested (from Instagram) once someone clicks play */
  let playing = $state(false);
  let video = $state<HTMLVideoElement>();

  // The play button disappears, so keyboard focus moves on to the player
  $effect(() => {
    if (playing) video?.focus();
  });
  // Not reactive on purpose: only avoids loading the same image twice
  const pendingLoads: Record<number, Promise<void>> = {};

  function markLoaded(i: number): void {
    if (!loaded.has(i)) loaded = new Set([...loaded, i]);
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
        img.src = getInstagramImageUrl(post.id, i);
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

  /** Steps from the requested image, so quick repeated clicks each count. */
  function browse(step: number): void {
    browsed = true;
    void show((target ?? index) + step);
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

  // Once the tile is visible and its first image is there, the other images are loaded one
  // after another in the background, starting with the next one
  let preloadStarted = false;
  $effect(() => {
    if (!isCarousel || !visible || !loaded.has(0) || preloadStarted) return;
    preloadStarted = true;
    const start = untrack(() => index);
    void (async () => {
      for (let step = 1; step < post.imageCount; step++) {
        await preload((start + step) % post.imageCount);
      }
    })();
  });

  // Advance slowly, but not while the tile is hovered or focused
  $effect(() => {
    if (!isCarousel || !visible || browsed || reducedMotion) return;
    const current = index;
    void pauseTick;
    const timer = setTimeout(() => {
      const tile = container?.closest('li') ?? container;
      if (tile?.matches(':hover, :focus-within')) pauseTick++;
      else void show(current + 1);
    }, AUTO_ADVANCE_MS + autoAdvanceOffset);
    return () => clearTimeout(timer);
  });
</script>

<div
  bind:this={container}
  class="relative aspect-square overflow-hidden bg-neutral-100"
  class:skeleton-element={!loaded.has(0)}
>
  {#each Array.from({ length: post.imageCount }, (_, i) => i) as i (i)}
    {#if i === 0 || loaded.has(i)}
      <img
        src={getInstagramImageUrl(post.id, i)}
        alt={i === index ? alt : ''}
        aria-hidden={i === index ? undefined : 'true'}
        width="640"
        height="640"
        loading={i === 0 ? 'lazy' : undefined}
        decoding="async"
        class="post-image absolute inset-0 h-full w-full object-cover group-hover:scale-105"
        class:post-image-loaded={loaded.has(i)}
        class:post-image-hidden={i !== index}
        onload={() => markLoaded(i)}
        onerror={() => markLoaded(i)}
      />
    {/if}
  {/each}

  {#if canPlay && playing}
    <!-- Instagram provides no captions -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={video}
      src={getInstagramVideoUrl(post.id)}
      poster={getInstagramImageUrl(post.id)}
      class="absolute inset-0 z-10 h-full w-full bg-black object-contain"
      controls
      autoplay
      playsinline
    ></video>
  {:else if canPlay}
    <!-- Above the link that covers the whole tile -->
    <button
      type="button"
      class="play-button"
      aria-label="Video abspielen (wird von Instagram geladen)"
      onclick={() => (playing = true)}
    >
      <span class="play-circle">
        <svg class="size-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"
          />
        </svg>
      </span>
      <span class="play-hint" aria-hidden="true">Video wird von Instagram geladen</span>
    </button>
  {:else if post.mediaType === 'VIDEO'}
    <!-- Not playable here (e.g. licensed music), so only marked as video -->
    <span
      class="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-brand-900/80 text-white"
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
    <span
      class="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-brand-900/80 px-2 py-1 text-xs font-semibold text-white tabular-nums"
      aria-hidden="true"
    >
      {#if target !== null}
        <!-- The requested image is still loading -->
        <span class="spinner"></span>
      {/if}
      {(target ?? index) + 1}/{post.imageCount}
    </span>
    {#if browsed}
      <span class="sr-only" aria-live="polite">Bild {index + 1} von {post.imageCount}</span>
    {/if}

    <button
      type="button"
      class="nav-button left-2"
      aria-label="Vorheriges Bild"
      onclick={() => browse(-1)}
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
      </svg>
    </button>
    <button
      type="button"
      class="nav-button right-2"
      aria-label="Nächstes Bild"
      onclick={() => browse(1)}
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
      </svg>
    </button>

    <div class="absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden="true">
      {#each Array.from({ length: post.imageCount }, (_, i) => i) as i (i)}
        <span class="dot" class:dot-active={i === (target ?? index)}></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Fades in from blurred to sharp once loaded */
  .post-image {
    opacity: 0;
    filter: blur(16px);
    transition:
      opacity 0.4s ease-out,
      filter 0.6s ease-out,
      scale 0.3s ease;
  }

  .post-image-loaded {
    opacity: 1;
    filter: blur(0);
  }

  /* The outgoing image stays until the incoming one has faded in */
  .post-image-hidden {
    opacity: 0;
    transition-delay: 0.4s;
  }

  /* Above the link that covers the whole tile */
  .nav-button {
    position: absolute;
    top: 50%;
    z-index: 10;
    display: flex;
    width: 2rem;
    height: 2rem;
    translate: 0 -50%;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.85);
    color: var(--color-brand-900);
    box-shadow: var(--shadow-soft);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .nav-button:focus-visible {
    opacity: 1;
    outline: 2px solid var(--color-dpsg-red);
    outline-offset: 2px;
  }

  :global(.group:hover) .nav-button {
    opacity: 1;
  }

  /* Touch devices have no hover, so the buttons are always shown there */
  @media (hover: none) {
    .nav-button {
      opacity: 1;
    }
  }

  .dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.55);
    box-shadow: 0 0 2px rgb(0 0 0 / 0.4);
    transition: background-color 0.3s ease;
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
    width: 3.5rem;
    height: 3.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.9);
    color: var(--color-brand-900);
    box-shadow: var(--shadow-soft);
    transition: scale 0.2s ease;
  }

  .play-button:hover .play-circle {
    scale: 1.08;
  }

  .play-button:focus-visible {
    outline: none;
  }

  .play-button:focus-visible .play-circle {
    outline: 2px solid var(--color-dpsg-red);
    outline-offset: 3px;
  }

  .play-hint {
    border-radius: 9999px;
    background: rgb(0 48 86 / 0.8);
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
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

  .dot-active {
    background: white;
  }
</style>
