import { moveTrack, releaseVelocity, startTrack, SWIPE_START, type SwipeTrack } from './swipe';

/** What a finger movement did to a horizontal swipe. */
export type SwipeMove =
  /** Not moved far enough to tell a swipe from a tap. */
  | { kind: 'wait' }
  /** More vertical than horizontal: left to the browser (scrolling) and forgotten. */
  | { kind: 'drop' }
  /** The swipe has just become horizontal; `dx` is the distance since the touch began. */
  | { kind: 'begin'; dx: number }
  | { kind: 'move'; dx: number };

export interface SwipeRelease {
  /** Distance of the whole swipe, positive to the right. */
  dx: number;
  /** Pixels per millisecond at release, 0 when the finger rested before letting go. */
  velocity: number;
  width: number;
}

/**
 * The decision part of a sideways swipe, without any DOM: a touch only becomes a swipe once it
 * moved `SWIPE_START` pixels more sideways than up or down; until then it is a tap or a scroll
 * and the browser keeps it. Vertical movement ends the track for good.
 */
export class HorizontalSwipe {
  #track: SwipeTrack | null = null;
  #width = 0;
  #active = false;

  /** A single finger touched down; `width` is the width of the area. */
  begin(x: number, y: number, time: number, width: number): void {
    this.#track = startTrack(x, y, time);
    this.#width = width;
    this.#active = false;
  }

  /** Width of the area when the finger touched down. */
  get width(): number {
    return this.#width;
  }

  /** Whether the touch became a horizontal swipe. */
  get active(): boolean {
    return this.#active;
  }

  move(x: number, y: number, time: number): SwipeMove {
    const track = this.#track;
    if (!track) return { kind: 'wait' };
    const dx = x - track.startX;
    const dy = y - track.startY;
    let begun = false;
    if (!this.#active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START) return { kind: 'wait' };
      if (Math.abs(dx) <= Math.abs(dy)) {
        this.#track = null;
        return { kind: 'drop' };
      }
      this.#active = true;
      begun = true;
    }
    moveTrack(track, x, y, time);
    return { kind: begun ? 'begin' : 'move', dx };
  }

  /** The finger lifted: the swipe, or `null` when it was no horizontal swipe. */
  end(time: number): SwipeRelease | null {
    const track = this.#track;
    const active = this.#active;
    this.#track = null;
    this.#active = false;
    if (!track || !active) return null;
    return {
      dx: track.lastX - track.startX,
      velocity: releaseVelocity(track, 'x', time),
      width: this.#width,
    };
  }

  /** The swipe was interrupted (a second finger, the system); whether it had begun moving. */
  cancel(): boolean {
    const active = this.#active;
    this.#track = null;
    this.#active = false;
    return active;
  }
}
