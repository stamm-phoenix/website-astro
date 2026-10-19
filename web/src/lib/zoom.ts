/*
 * Numbers of the zoom in the large photo view: scale and shift of the picture, kept around a
 * point and inside the picture's edges. Positions are in pixels relative to the centre of the
 * view, so an unzoomed picture is { scale: 1, x: 0, y: 0 }.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** The scale of a double tap and of the button „Vergrößern“. */
export const ZOOM_STEP = 2.5;
/** A pinch that ends below this scale returns to the whole picture. */
export const ZOOM_SNAP = 1.05;
/** Two taps within this time and distance are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DISTANCE = 24;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Zoom {
  scale: number;
  /** Shift of the picture's centre from the view's centre, in pixels. */
  x: number;
  y: number;
}

export interface Tap extends Point {
  time: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Size of a picture with the aspect `ratio` (width / height) fitted into `box`. */
export function containedSize(box: Size, ratio: number): Size {
  if (!(ratio > 0) || box.width <= 0 || box.height <= 0) return box;
  return box.width / box.height > ratio
    ? { width: box.height * ratio, height: box.height }
    : { width: box.width, height: box.width / ratio };
}

/** Scales to `scale` and keeps the point of the picture under `focus` where it is. */
export function zoomAround(zoom: Zoom, scale: number, focus: Point): Zoom {
  const next = clampScale(scale);
  return {
    scale: next,
    x: focus.x - (next * (focus.x - zoom.x)) / zoom.scale,
    y: focus.y - (next * (focus.y - zoom.y)) / zoom.scale,
  };
}

/**
 * A pinch: the scale follows the distance between the fingers, and the point of the picture
 * that was between them at the start stays between them as they move.
 */
export function pinchZoom(
  start: Zoom,
  startMid: Point,
  startDistance: number,
  mid: Point,
  distance: number
): Zoom {
  if (startDistance <= 0) return start;
  const scale = clampScale((start.scale * distance) / startDistance);
  return {
    scale,
    x: mid.x - (scale * (startMid.x - start.x)) / start.scale,
    y: mid.y - (scale * (startMid.y - start.y)) / start.scale,
  };
}

/** How far the picture's centre may move from the view's centre before an edge shows. */
export function panLimit(picture: Size, view: Size, scale: number): Point {
  return {
    x: Math.max(0, (picture.width * scale - view.width) / 2),
    y: Math.max(0, (picture.height * scale - view.height) / 2),
  };
}

/**
 * Keeps the picture inside its edges. With `give`, a shift past an edge is not cut off but
 * reduced to `give(overshoot)`, so the picture yields a little like a rubber band.
 */
export function clampPan(zoom: Zoom, limit: Point, give?: (overshoot: number) => number): Zoom {
  const clamp = (value: number, max: number): number => {
    const overshoot = Math.abs(value) - max;
    if (overshoot <= 0) return value;
    return Math.sign(value) * (max + (give ? give(overshoot) : 0));
  };
  return { scale: zoom.scale, x: clamp(zoom.x, limit.x), y: clamp(zoom.y, limit.y) };
}

/** Whether `tap` follows `previous` closely enough in time and place to be a double tap. */
export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
  if (!previous) return false;
  const elapsed = tap.time - previous.time;
  return (
    elapsed >= 0 &&
    elapsed <= DOUBLE_TAP_MS &&
    Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_DISTANCE
  );
}

export function isZoomed(zoom: Zoom): boolean {
  return zoom.scale > ZOOM_MIN;
}
