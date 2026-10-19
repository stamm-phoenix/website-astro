<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { NOTICE_CLASS } from '../../lib/status';
  import {
    SWIPE_START,
    commits,
    moveTrack,
    panelDuration,
    releaseVelocity,
    settleDuration,
    startTrack,
    type SwipeTrack,
  } from '../../lib/swipe';
  import type { NoticeKind } from '../../lib/status';
  import ActionButton from './ActionButton.svelte';
  import MessageText from './MessageText.svelte';

  interface Props {
    /** Text of the confirmation; `null` hides the popup. */
    message: string | null;
    kind?: NoticeKind;
    actionLabel?: string;
    href?: string;
    linkLabel?: string;
    /** Keep an action visible but unavailable while another request is running. */
    actionDisabled?: boolean;
    onaction?: () => void;
    onclose: () => void;
    /**
     * Milliseconds until the popup closes itself while not hovered or focused; 0 keeps it until
     * it is closed, e.g. while its action is the only way to save again.
     */
    duration?: number;
    /** False when another live region already announces the same message. */
    announce?: boolean;
  }
  let {
    message,
    kind = 'success',
    actionLabel,
    href,
    linkLabel,
    actionDisabled = false,
    onaction,
    onclose,
    duration = kind === 'success' ? 6000 : 10000,
    announce = true,
  }: Props = $props();
  let paused = $state(false);
  /** A finger rests on the popup: it does not close itself meanwhile. */
  let touching = $state(false);

  /*
   * Swiping sideways dismisses the popup: it follows the finger and fades with the distance.
   * Past 40 % of its width or with a sideways flick it closes, otherwise it settles back. It
   * only starts once the finger moves more sideways than up or down, so scrolling and taps on
   * its buttons and links keep working.
   */
  let offset = $state(0);
  let swiping = $state(false);
  /** Milliseconds of the running settle back. */
  let settle = $state(0);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let track: SwipeTrack | null = null;
  let width = 1;
  const fade = $derived(Math.max(0, 1 - Math.abs(offset) / width));

  function onTouchStart(event: TouchEvent): void {
    touching = true;
    track = null;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    track = startTrack(touch.clientX, touch.clientY, event.timeStamp);
    width = Math.max(1, (event.currentTarget as HTMLElement).offsetWidth);
  }

  function onTouchMove(event: TouchEvent): void {
    if (!track || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!swiping) {
      const dx = touch.clientX - track.startX;
      const dy = touch.clientY - track.startY;
      if (Math.abs(dx) > SWIPE_START && Math.abs(dx) > Math.abs(dy)) {
        // Start from here, so the popup does not jump by the distance needed to start
        track = startTrack(touch.clientX, touch.clientY, event.timeStamp);
        clearTimeout(settleTimer);
        settle = 0;
        swiping = true;
      } else {
        if (Math.abs(dy) > SWIPE_START) track = null;
        return;
      }
    }
    event.preventDefault();
    moveTrack(track, touch.clientX, touch.clientY, event.timeStamp);
    offset = touch.clientX - track.startX;
  }

  function onTouchEnd(event: TouchEvent): void {
    if (event.touches.length === 0) touching = false;
    const ended = track;
    track = null;
    if (!ended || !swiping) return;
    // The finger moved: no click on the button or link it started on
    if (event.cancelable) event.preventDefault();
    swiping = false;
    const direction = Math.sign(offset) || 1;
    const velocity = releaseVelocity(ended, 'x', event.timeStamp) * direction;
    if (event.type === 'touchend' && commits(Math.abs(offset), velocity, width * 0.4)) {
      // No exit delay, like the close button: the popup and its actions disappear at once
      clearTimeout(settleTimer);
      offset = 0;
      settle = 0;
      onclose();
      return;
    }
    settle = settleDuration(offset, -velocity, panelDuration());
    offset = 0;
    clearTimeout(settleTimer);
    if (settle > 0) settleTimer = setTimeout(() => (settle = 0), settle);
  }

  // Stopping the page from scrolling sideways needs a non-passive touchmove listener
  const swipeGesture: Attachment<HTMLElement> = (element) => {
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      element.removeEventListener('touchmove', onTouchMove);
      clearTimeout(settleTimer);
    };
  };

  $effect(() => {
    if (!message || paused || touching || actionDisabled || duration <= 0) return;
    const timer = setTimeout(onclose, duration);
    return () => clearTimeout(timer);
  });
</script>

<!-- The live region stays in the DOM so screen readers announce each new message. -->
<div
  data-toast
  class="toast-container pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
  role={announce ? 'status' : undefined}
  aria-live={announce ? 'polite' : undefined}
>
  {#if message}
    <div
      class="toast-message surface pointer-events-auto flex w-full max-w-md items-center gap-3 border-l-4 py-3 pl-4 pr-2 shadow-[var(--shadow-lift)] {NOTICE_CLASS[
        kind
      ]}"
      role="presentation"
      style:transform={swiping || settle > 0 ? `translateX(${offset}px)` : undefined}
      style:opacity={swiping || settle > 0 ? fade : undefined}
      style:transition={swiping || settle > 0
        ? settle > 0
          ? `transform ${settle}ms var(--motion-enter), opacity ${settle}ms ease-out`
          : 'none'
        : undefined}
      {@attach swipeGesture}
      ontouchstart={onTouchStart}
      ontouchend={onTouchEnd}
      ontouchcancel={onTouchEnd}
      onmouseenter={() => (paused = true)}
      onmouseleave={() => (paused = false)}
      onfocusin={() => (paused = true)}
      onfocusout={() => (paused = false)}
    >
      <svg
        class="size-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {#if kind === 'success'}
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2.5"
            d="m5 13 4 4L19 7"
          />
        {:else}
          <path stroke-linecap="round" stroke-width="2.5" d="M12 7v6m0 4h.01" />
        {/if}
      </svg>
      <p class="min-w-0 flex-1 text-sm font-semibold text-brand-900">
        <MessageText text={message} />{#if href && linkLabel}
          <a class="text-link inline-flex min-h-11 items-center" {href}>{linkLabel}</a>{/if}
      </p>
      {#if actionLabel && onaction}
        <ActionButton
          variant="secondary"
          type="button"
          class="shrink-0"
          disabled={actionDisabled}
          onclick={() => {
            onaction();
            onclose();
          }}>{actionLabel}</ActionButton
        >
      {/if}
      <button
        type="button"
        class="flex size-9 shrink-0 items-center justify-center text-neutral-700"
        aria-label="Hinweis schließen"
        onclick={onclose}
      >
        <svg
          class="size-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-width="2.5" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  /* No exit delay: dismissed messages and their actions disappear at once. */
  .toast-message {
    /* Vertical scrolling stays with the browser, sideways belongs to the swipe */
    touch-action: pan-y;
    transition:
      opacity var(--motion-quick) ease-out,
      transform var(--motion-quick) var(--motion-enter);
  }
  @starting-style {
    .toast-message {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast-message {
      transition: none;
    }
  }
  .toast-container {
    bottom: calc(1rem + var(--staff-bar-h, env(safe-area-inset-bottom, 0px)));
  }
</style>
