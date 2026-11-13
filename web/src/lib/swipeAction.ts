import type { Attachment } from 'svelte/attachments';
import { HorizontalSwipe, type SwipeRelease } from './swipeGesture';

/** Within a link (a card), a click this late after a swipe still belongs to the swipe. */
const SWIPE_CLICK_MS = 400;

export interface TouchHandlers {
  start?: (event: TouchEvent) => void;
  move?: (event: TouchEvent) => void;
  end?: (event: TouchEvent) => void;
  cancel?: (event: TouchEvent) => void;
}

/**
 * Registers the touch handlers on `area`: `touchmove` is not passive, so a gesture can keep the
 * page from scrolling. Returns the function that removes them again.
 */
export function onTouch(area: HTMLElement, handlers: TouchHandlers): () => void {
  const { start, move, end, cancel } = handlers;
  if (start) area.addEventListener('touchstart', start, { passive: true });
  if (move) area.addEventListener('touchmove', move, { passive: false });
  if (end) area.addEventListener('touchend', end);
  if (cancel) area.addEventListener('touchcancel', cancel);
  return () => {
    if (start) area.removeEventListener('touchstart', start);
    if (move) area.removeEventListener('touchmove', move);
    if (end) area.removeEventListener('touchend', end);
    if (cancel) area.removeEventListener('touchcancel', cancel);
  };
}

export interface SwipeXMove {
  dx: number;
  /** Width of the area when the finger touched down. */
  width: number;
  area: HTMLElement;
}

export interface SwipeXOptions {
  /** Every `touchstart`, also of a second finger, before the swipe handles it. */
  ontouchstart?: (event: TouchEvent) => void;
  /** Every `touchend`, before the swipe handles it. */
  ontouchend?: (event: TouchEvent) => void;
  /** Every `touchcancel`, before the swipe handles it. */
  ontouchcancel?: (event: TouchEvent) => void;
  /** A single finger touched down. */
  onbegin?: (event: TouchEvent, area: HTMLElement) => void;
  /** The touch has just turned out to be sideways; `dx` is the distance so far. */
  onstart?: (move: SwipeXMove) => void;
  /** The finger moved sideways, `dx` pixels from where it touched down. */
  onmove: (move: SwipeXMove) => void;
  /** The finger lifted after a sideways swipe. */
  onrelease: (release: SwipeRelease, event: TouchEvent, area: HTMLElement) => void;
  /** A started swipe was interrupted by a second finger or the system. */
  oncancel?: (area: HTMLElement) => void;
  /**
   * Keeps the click some browsers (Safari) still send after a swipe from reaching a link the
   * swipe started on: after a sideways release, the next click in the area is swallowed, for
   * at most 400 milliseconds or until the next touch.
   */
  swallowClick?: boolean;
}

/**
 * A sideways swipe on an element (`{@attach swipeX(options)}`). The element follows the finger
 * through `onmove`; vertical movement and pinching stay with the browser, so the page still
 * scrolls. What the swipe does, its limits and its animation stay with the component.
 */
export function swipeX(options: SwipeXOptions): Attachment<HTMLElement> {
  return (area) => {
    const gesture = new HorizontalSwipe();
    const swallowing = options.swallowClick === true;
    let swallowNext = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    function cancel(): void {
      if (gesture.cancel()) options.oncancel?.(area);
    }

    function guardClick(event: MouseEvent): void {
      if (!swallowNext) return;
      swallowNext = false;
      event.preventDefault();
      event.stopPropagation();
    }

    const removeTouch = onTouch(area, {
      start(event) {
        swallowNext = false;
        options.ontouchstart?.(event);
        if (event.touches.length !== 1) {
          cancel();
          return;
        }
        const touch = event.touches[0]!;
        gesture.begin(touch.clientX, touch.clientY, event.timeStamp, area.clientWidth);
        options.onbegin?.(event, area);
      },
      move(event) {
        if (event.touches.length !== 1) {
          cancel();
          return;
        }
        const touch = event.touches[0]!;
        const result = gesture.move(touch.clientX, touch.clientY, event.timeStamp);
        if (result.kind === 'wait' || result.kind === 'drop') return;
        const move = { dx: result.dx, width: gesture.width, area };
        if (result.kind === 'begin') options.onstart?.(move);
        if (event.cancelable) event.preventDefault();
        options.onmove(move);
      },
      end(event) {
        options.ontouchend?.(event);
        const release = gesture.end(event.timeStamp);
        if (!release) return;
        if (swallowing) {
          swallowNext = true;
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => (swallowNext = false), SWIPE_CLICK_MS);
        }
        options.onrelease(release, event, area);
      },
      cancel(event) {
        options.ontouchcancel?.(event);
        cancel();
      },
    });
    if (swallowing) area.addEventListener('click', guardClick, true);

    return () => {
      clearTimeout(clickTimer);
      removeTouch();
      area.removeEventListener('click', guardClick, true);
    };
  };
}
