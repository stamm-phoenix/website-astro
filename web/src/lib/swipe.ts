/*
 * Shared pieces of the touch gestures: tracking the finger, deciding on release and finishing
 * the movement at the speed the finger left it. Components keep their own state and only the
 * numbers come from here, so a gesture never waits for an animation to end.
 */

/** Movement in pixels before a touch counts as a swipe instead of a tap. */
export const SWIPE_START = 8;
/** A finger that rested this long before letting go was not flicking. */
const FLICK_PAUSE = 100;
/** Pixels per millisecond that count as a flick, whatever the distance. */
export const FLICK_VELOCITY = 0.5;
/**
 * Initial slope of `--motion-enter` (cubic-bezier(0.16, 1, 0.3, 1)): y1 / x1. A settle of
 * `distance` over `duration` starts at `SLOPE * distance / duration` pixels per millisecond.
 */
const SLOPE = 1 / 0.16;
const MIN_SETTLE = 120;

export interface SwipeTrack {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  /** Pixels per millisecond along each axis, positive right and down. */
  velocityX: number;
  velocityY: number;
}

export function startTrack(x: number, y: number, time: number): SwipeTrack {
  return { startX: x, startY: y, lastX: x, lastY: y, lastTime: time, velocityX: 0, velocityY: 0 };
}

export function moveTrack(track: SwipeTrack, x: number, y: number, time: number): void {
  const elapsed = time - track.lastTime;
  if (elapsed > 0) {
    track.velocityX = (x - track.lastX) / elapsed;
    track.velocityY = (y - track.lastY) / elapsed;
  }
  track.lastX = x;
  track.lastY = y;
  track.lastTime = time;
}

/** The speed at release along one axis; 0 when the finger rested before letting go. */
export function releaseVelocity(track: SwipeTrack, axis: 'x' | 'y', time: number): number {
  if (time - track.lastTime > FLICK_PAUSE) return 0;
  return axis === 'x' ? track.velocityX : track.velocityY;
}

/**
 * Whether a release finishes the gesture: dragged past `threshold` pixels, or flicked in its
 * direction. A flick against the direction cancels it even past the threshold.
 */
export function commits(dragged: number, velocity: number, threshold: number): boolean {
  if (velocity <= -FLICK_VELOCITY) return false;
  return dragged > threshold || velocity >= FLICK_VELOCITY;
}

/** Resistance past a limit: the element gives a little and springs back on release. */
export function rubberBand(overshoot: number, limit = 24): number {
  return Math.min(limit, Math.sqrt(Math.max(0, overshoot)) * 2);
}

/**
 * Milliseconds for the rest of a movement, so it starts at the speed the finger left it.
 * `velocity` is towards the target in pixels per millisecond; without one, or for a slow
 * finger, it takes the full `duration`.
 */
export function settleDuration(distance: number, velocity: number, duration: number): number {
  if (duration <= 0) return 0;
  const remaining = Math.abs(distance);
  if (velocity <= 0 || remaining === 0) return duration;
  return Math.round(Math.min(duration, Math.max(MIN_SETTLE, (SLOPE * remaining) / velocity)));
}

/**
 * `--motion-panel` in milliseconds, read at the moment of use: 0 with Reduced Motion, so the
 * same settle becomes an immediate jump without a separate check.
 */
export function panelDuration(): number {
  if (typeof window === 'undefined') return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--motion-panel');
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.trim().endsWith('ms') ? parsed : parsed * 1000;
}

/** The inline transition for a settle; `none` while the finger moves or without motion. */
export function settleTransition(property: string, duration: number): string {
  return duration > 0 ? `${property} ${duration}ms var(--motion-enter)` : 'none';
}
