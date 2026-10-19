<script lang="ts">
  import { untrack, onMount, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
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
  /**
   * Focus return: when the opener is gone after closing, focus moves to the first enabled
   * button of the neighbouring `[data-focus-item]` element, then to `[data-focus-fallback]`.
   */
  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    onopen?: () => void;
    sheet?: boolean;
    showClose?: boolean;
    closeDisabled?: boolean;
    /** Label of the close button in the header. */
    closeLabel?: string;
    /** `wide` (44rem) for forms, `medium` (40rem) for details, `narrow` (28rem) for questions. */
    size?: 'wide' | 'medium' | 'narrow';
    /** Close on a click on the dimmed area around the dialog. Only for dialogs without input. */
    dismissOnBackdrop?: boolean;
    /** Stronger shadow and darker backdrop, so a question stands out from a dialog behind it. */
    prominent?: boolean;
    children: Snippet;
  }
  let {
    open,
    title,
    onclose,
    onopen,
    sheet = false,
    showClose = true,
    closeDisabled = false,
    closeLabel = 'Schließen',
    size = 'wide',
    dismissOnBackdrop = false,
    prominent = false,
    children,
  }: Props = $props();
  const WIDTH = {
    wide: 'w-[min(44rem,calc(100%-2rem))]',
    medium: 'w-[min(40rem,calc(100%-2rem))]',
    narrow: 'w-[min(28rem,calc(100%-4rem))]',
  } as const;
  /** Whether the current click started on the backdrop, so a drag out of the dialog keeps it open. */
  let pressedBackdrop = false;
  let dialog = $state<HTMLDialogElement | null>(null);
  const id = $props.id();
  let wasOpen = false;
  let opener: HTMLElement | null = null;
  let nearby: HTMLElement | null = null;
  let parentModal: HTMLDialogElement | null = null;
  function restoreFocus(): void {
    const source = opener;
    const neighbor = nearby;
    const parent = parentModal;
    opener = null;
    nearby = null;
    parentModal = null;
    requestAnimationFrame(() => {
      if (document.querySelector('dialog[open]') || (parent && !parent.isConnected)) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.closest('dialog')
      )
        return;
      const target = source?.isConnected
        ? source
        : neighbor?.isConnected
          ? neighbor.querySelector<HTMLElement>('button:not(:disabled)')
          : document.querySelector<HTMLElement>('[data-focus-fallback]');
      target?.focus({ preventScroll: true });
    });
  }
  onMount(() => () => {
    if (wasOpen) restoreFocus();
  });

  /*
   * On phones a sheet sits at the bottom and can be pulled down from its header, or from its
   * content once that is scrolled to the top. Released past a third of its height or with a
   * flick it closes through `onclose` at once, like the close button; otherwise it settles back.
   */
  const PHONE = '(max-width: 639px)';
  let header = $state<HTMLElement | null>(null);
  /** How far the sheet is pulled down; negative is the rubber band upwards. */
  let pull = $state(0);
  /** Milliseconds of the running settle back, 0 while the finger moves or at rest. */
  let settle = $state(0);
  /** Curve of the settle back, starting at the speed of the released finger. */
  let settleCurve = $state('var(--motion-enter)');
  let pulling = $state(false);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let track: SwipeTrack | null = null;
  let fromHeader = false;

  function pullable(): boolean {
    return sheet && !closeDisabled && window.matchMedia(PHONE).matches;
  }

  /** Whether the touch started in content that is scrolled down, so the finger scrolls it. */
  function scrolledBelowTop(target: EventTarget | null): boolean {
    for (
      let node = target instanceof Element ? target : null;
      node && node !== dialog;
      node = node.parentElement
    ) {
      if (node.scrollTop > 0) return true;
    }
    return false;
  }

  function resetPull(): void {
    clearTimeout(settleTimer);
    track = null;
    pulling = false;
    pull = 0;
    settle = 0;
  }

  function onTouchStart(event: TouchEvent): void {
    track = null;
    if (event.touches.length !== 1 || !pullable()) return;
    const target = event.target;
    fromHeader = target instanceof Node && !!header?.contains(target);
    if (!fromHeader && scrolledBelowTop(target)) return;
    const touch = event.touches[0];
    track = startTrack(touch.clientX, touch.clientY, event.timeStamp);
  }

  function onTouchMove(event: TouchEvent): void {
    if (!track || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!pulling) {
      const dx = touch.clientX - track.startX;
      const dy = touch.clientY - track.startY;
      if (dy > SWIPE_START && dy > Math.abs(dx)) {
        // Start from here, so the sheet does not jump by the distance needed to start
        track = startTrack(touch.clientX, touch.clientY, event.timeStamp);
        clearTimeout(settleTimer);
        settle = 0;
        pulling = true;
      } else {
        // Scrolling the content, or a movement that is not (yet) a pull
        if (Math.abs(dx) > SWIPE_START || Math.abs(dy) > SWIPE_START) track = null;
        return;
      }
    }
    event.preventDefault();
    moveTrack(track, touch.clientX, touch.clientY, event.timeStamp);
    const pulled = touch.clientY - track.startY;
    pull = pulled >= 0 ? pulled : -rubberBand(-pulled);
  }

  function onTouchEnd(event: TouchEvent): void {
    const ended = track;
    track = null;
    if (!ended || !pulling) return;
    // The finger moved: no click on the button it started on
    if (event.cancelable) event.preventDefault();
    pulling = false;
    const velocity = releaseVelocity(ended, 'y', event.timeStamp);
    const height = dialog?.offsetHeight ?? window.innerHeight;
    if (event.type === 'touchend' && commits(pull, velocity, height / 3)) {
      // Closing is immediate, like the close button: state and focus do not wait for motion
      resetPull();
      onclose();
      return;
    }
    settle = settleDuration(pull, -velocity, panelDuration());
    settleCurve = settleEasing(pull, -velocity, settle);
    pull = 0;
    clearTimeout(settleTimer);
    if (settle > 0) settleTimer = setTimeout(() => (settle = 0), settle);
  }

  // Stopping the page from scrolling while pulling needs a non-passive touchmove listener
  const pullGesture: Attachment<HTMLDialogElement> = (element) => {
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      element.removeEventListener('touchmove', onTouchMove);
      clearTimeout(settleTimer);
    };
  };

  $effect(() => {
    if (open && dialog && !dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      parentModal = opener?.closest('dialog') ?? null;
      const item = opener?.closest('[data-focus-item]');
      nearby = (item?.nextElementSibling ?? item?.previousElementSibling) as HTMLElement | null;
      untrack(() => onopen?.());
      dialog.showModal();
      wasOpen = true;
    }
    if (!open && dialog?.open) {
      untrack(resetPull);
      dialog.close();
      wasOpen = false;
      restoreFocus();
    }
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={id}
  class="m-auto max-h-[calc(100dvh-2rem)] {WIDTH[
    size
  ]} rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  class:action-sheet={sheet}
  class:prominent
  style:transform={pulling || settle > 0 ? `translateY(${pull}px)` : undefined}
  style:transition={pulling || settle > 0
    ? settleTransition('transform', settle, settleCurve)
    : undefined}
  {@attach pullGesture}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
  onpointerdown={(event) => {
    pressedBackdrop = event.target === dialog;
  }}
  onclick={(event) => {
    const outside = pressedBackdrop && event.target === dialog;
    pressedBackdrop = false;
    if (outside && dismissOnBackdrop && !closeDisabled) onclose();
  }}
  onclose={() => {
    // Native close events are queued: an immediate reopen must keep its new state and focus.
    if (dialog?.open) return;
    wasOpen = false;
    if (opener) restoreFocus();
    if (open) onclose();
  }}
  oncancel={(event) => {
    event.preventDefault();
    if (!closeDisabled) onclose();
  }}
>
  {#if open}
    <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
      <div bind:this={header} class="shrink-0 border-b border-neutral-200">
        {#if sheet && !closeDisabled}
          <!-- Grip: on phones the sheet can be pulled down to close it -->
          <div
            aria-hidden="true"
            class="mx-auto mt-2 -mb-2 h-1.5 w-10 rounded-full bg-neutral-300 sm:hidden"
          ></div>
        {/if}
        <div class="flex items-center justify-between gap-4 px-5 py-4">
          <h2 {id} class="font-serif text-xl font-semibold text-brand-900">{title}</h2>
          {#if showClose}
            <button
              type="button"
              class="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
              aria-label={closeLabel}
              disabled={closeDisabled}
              onclick={onclose}
            >
              <svg
                aria-hidden="true"
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
              >
            </button>
          {/if}
        </div>
      </div>
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  /* Opening is visual only. Closing leaves the top layer and returns focus immediately. */
  dialog[open] {
    opacity: 1;
    transform: none;
    transition:
      opacity var(--motion-quick) ease-out,
      transform var(--motion-panel) var(--motion-enter);
  }
  @starting-style {
    dialog[open] {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
  .prominent {
    border-color: var(--color-neutral-300);
    box-shadow:
      0 24px 48px rgb(0 20 40 / 0.35),
      0 4px 12px rgb(0 20 40 / 0.25);
  }
  .prominent::backdrop {
    background: var(--dialog-backdrop-strong, rgb(0 30 56 / 0.55));
  }
  @media (max-width: 639px) {
    .action-sheet {
      margin: auto 0 0;
      width: 100%;
      max-width: none;
      border-radius: 1rem 1rem 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
    @starting-style {
      .action-sheet[open] {
        transform: translateY(16px);
      }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog[open] {
      transition: none;
    }
    @starting-style {
      dialog[open] {
        opacity: 1;
        transform: none;
      }
    }
  }
</style>
