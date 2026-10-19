import type { Action } from 'svelte/action';

/** How long a finger rests on an element before it counts as a long press. */
const DELAY = 500;
/** A finger that moves further is scrolling or swiping, not pressing. */
const SLOP = 10;

/**
 * Calls `callback` when a finger or pen rests on the element (tap and hold), instead of opening
 * the link or the menu of the browser. The mouse is left alone; it has its own controls.
 */
export const longPress: Action<HTMLElement, (() => void) | undefined> = (node, callback) => {
  let handler = callback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  /** A long press happened in this touch; its click and the menu of the browser are swallowed. */
  let fired = false;

  function cancel(): void {
    clearTimeout(timer);
    start = null;
  }
  function fire(): void {
    cancel();
    fired = true;
    if ('vibrate' in navigator) navigator.vibrate(15);
    handler?.();
  }
  function onpointerdown(event: PointerEvent): void {
    fired = false;
    if (event.pointerType === 'mouse' || !event.isPrimary || !handler) return;
    start = { x: event.clientX, y: event.clientY };
    clearTimeout(timer);
    timer = setTimeout(fire, DELAY);
  }
  function onpointermove(event: PointerEvent): void {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP) cancel();
  }
  // Android opens its link menu on a long press, sometimes before the timer
  function oncontextmenu(event: Event): void {
    if (start) {
      event.preventDefault();
      fire();
    } else if (fired) event.preventDefault();
  }
  function onclick(event: Event): void {
    if (!fired) return;
    // Only the click that ends this touch
    fired = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // iOS shows its link preview and selects text on a long press otherwise
  node.style.setProperty('-webkit-touch-callout', 'none');
  node.style.setProperty('-webkit-user-select', 'none');
  node.style.setProperty('user-select', 'none');
  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('pointermove', onpointermove);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', oncontextmenu);
  node.addEventListener('click', onclick, true);
  return {
    update(next) {
      handler = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointermove', onpointermove);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('contextmenu', oncontextmenu);
      node.removeEventListener('click', onclick, true);
    },
  };
};
