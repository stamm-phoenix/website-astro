/*
 * Folding and unfolding the desktop sidebar by dragging it with the mouse: to the left folds the
 * open sidebar, to the right unfolds the folded one. Only an addition to the button; a click, a
 * small slip of the mouse or a drag that is let go early changes nothing.
 */
import { commits, moveTrack, releaseVelocity, startTrack } from './swipe';
import type { SwipeTrack } from './swipe';

/** Pixels along the drag direction before a pressed mouse counts as dragging, not clicking. */
export const DRAG_START = 12;
/** Pixels in the drag direction that fold or unfold the sidebar on release. */
export const DRAG_COMMIT = 64;

/** +1: the drag unfolds (to the right), -1: it folds (to the left). */
export type DragDirection = 1 | -1;

export function dragDirection(collapsed: boolean): DragDirection {
  return collapsed ? 1 : -1;
}

/**
 * What a movement so far means: `drag` once it went far enough in the direction and mostly
 * sideways, `none` once it went elsewhere (selecting text, scrolling), `wait` until then.
 */
export function classifyMove(
  dx: number,
  dy: number,
  direction: DragDirection
): 'wait' | 'drag' | 'none' {
  const along = dx * direction;
  if (Math.abs(dy) >= DRAG_START && Math.abs(dy) >= Math.abs(dx)) return 'none';
  if (along <= -DRAG_START) return 'none';
  if (along >= DRAG_START && along > Math.abs(dy)) return 'drag';
  return 'wait';
}

/** Whether a release finishes the drag: far enough or flicked in the direction. */
export function dragCommits(dx: number, velocityX: number, direction: DragDirection): boolean {
  return commits(dx * direction, velocityX * direction, DRAG_COMMIT);
}

export interface SidebarDragOptions {
  /** Read at the start of each drag. */
  collapsed: () => boolean;
  /** Only while this holds (the wide layout), a drag starts. */
  enabled: () => boolean;
  /** Pixels moved sideways while dragging, `null` when the drag ends. */
  onmove: (dx: number | null) => void;
  /** The drag was finished in its direction. */
  oncommit: () => void;
}

/** Where a press must not start a drag: text fields keep selecting text. */
const NO_DRAG = 'input, textarea, select, [contenteditable]';

/** Svelte action for the sidebar `<nav>`. */
export function sidebarDrag(
  node: HTMLElement,
  options: SidebarDragOptions
): { update: (next: SidebarDragOptions) => void; destroy: () => void } {
  let current = options;
  let pointer: number | null = null;
  let direction: DragDirection = -1;
  let track: SwipeTrack | null = null;
  /** `wait` until the movement decides, `drag` while dragging, `cancelled` after Escape. */
  let phase: 'wait' | 'drag' | 'cancelled' = 'wait';

  function stopDragging(): void {
    if (phase === 'drag') current.onmove(null);
  }

  function reset(): void {
    stopDragging();
    if (pointer !== null && node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
    pointer = null;
    track = null;
    phase = 'wait';
  }

  /** The click after a drag would follow the link or press the button the mouse started on. */
  function swallowClick(): void {
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !current.enabled()) return;
    if (event.target instanceof Element && event.target.closest(NO_DRAG)) return;
    pointer = event.pointerId;
    direction = dragDirection(current.collapsed());
    track = startTrack(event.clientX, event.clientY, event.timeStamp);
    phase = 'wait';
  }

  function onpointermove(event: PointerEvent): void {
    if (event.pointerId !== pointer || !track || phase === 'cancelled') return;
    if ((event.buttons & 1) === 0) {
      reset();
      return;
    }
    moveTrack(track, event.clientX, event.clientY, event.timeStamp);
    const dx = event.clientX - track.startX;
    if (phase === 'wait') {
      const kind = classifyMove(dx, event.clientY - track.startY, direction);
      if (kind === 'none') {
        reset();
        return;
      }
      if (kind === 'wait') return;
      phase = 'drag';
      node.setPointerCapture(event.pointerId);
    }
    window.getSelection()?.removeAllRanges();
    current.onmove(dx);
  }

  function onpointerup(event: PointerEvent): void {
    if (event.pointerId !== pointer || !track) return;
    const ended = phase;
    const finished =
      ended === 'drag' &&
      dragCommits(
        event.clientX - track.startX,
        releaseVelocity(track, 'x', event.timeStamp),
        direction
      );
    reset();
    if (ended === 'wait') return;
    swallowClick();
    if (finished) current.oncommit();
  }

  function oncancel(event: PointerEvent): void {
    if (event.pointerId === pointer) reset();
  }

  /** Dragging a link the native way would end the pointer events; in the direction it is ours. */
  function ondragstart(event: DragEvent): void {
    if (!track) return;
    const kind = classifyMove(
      event.clientX - track.startX,
      event.clientY - track.startY,
      direction
    );
    if (phase === 'drag' || kind !== 'none') event.preventDefault();
  }

  /** Escape lets the sidebar spring back; letting go of the mouse then does nothing. */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || phase !== 'drag') return;
    stopDragging();
    phase = 'cancelled';
  }

  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('dragstart', ondragstart);
  window.addEventListener('pointermove', onpointermove);
  window.addEventListener('pointerup', onpointerup);
  window.addEventListener('pointercancel', oncancel);
  window.addEventListener('keydown', onkeydown);
  window.addEventListener('blur', reset);

  return {
    update(next) {
      current = next;
    },
    destroy() {
      reset();
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('dragstart', ondragstart);
      window.removeEventListener('pointermove', onpointermove);
      window.removeEventListener('pointerup', onpointerup);
      window.removeEventListener('pointercancel', oncancel);
      window.removeEventListener('keydown', onkeydown);
      window.removeEventListener('blur', reset);
    },
  };
}
