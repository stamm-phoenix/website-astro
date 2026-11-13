/**
 * When to save automatically: after a quiet time, at the latest after a longest wait while
 * changes keep coming, never two saves at once, and again after a failure. What a save does is
 * up to the caller (`run`).
 */
import { systemClock, type Clock } from './clock';
import { SAVE_DELAY_MS, retryDelay, saveWait } from './protokollSpeichern';

/** How a save started: nothing to send, the input is not valid yet, or the promise of the request. */
export type SaveStart = 'unchanged' | 'invalid' | Promise<void>;

export interface AutosaveOptions {
  /** Whether saving is possible at all; checked before every save. */
  active: () => boolean;
  /** Starts one save. Must not throw; failures are handled inside the returned promise. */
  run: () => SaveStart;
  clock?: Clock;
}

export class Autosave {
  private readonly options: AutosaveOptions;
  private readonly clock: Clock;
  private cancelTimer: (() => void) | null = null;
  /** The save whose request is on its way. */
  private inflight: Promise<void> | null = null;
  /** A change arrived during a save: save again once it is done. */
  private again = false;
  /** Start of the oldest change not on its way to the server yet. */
  private firstPendingAt: number | null = null;
  private failures = 0;

  constructor(options: AutosaveOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
  }

  /** Whether a request is on its way. */
  get saving(): boolean {
    return this.inflight !== null;
  }

  /** Saves after the quiet time, or earlier when the oldest change waits too long. */
  schedule(delay = SAVE_DELAY_MS): void {
    this.cancel();
    const now = this.clock.now();
    this.firstPendingAt ??= now;
    this.setTimer(saveWait(delay, this.firstPendingAt, now));
  }

  /**
   * Tries again after the wait for this number of failures in a row. Replaces the timer without
   * cancelling one set meanwhile, so a change typed during the failed save is still saved soon.
   */
  retryLater(): void {
    this.setTimer(retryDelay(this.failures));
    this.failures++;
  }

  /** A save went through: the next failure waits the shortest time again. */
  succeeded(): void {
    this.failures = 0;
  }

  /** Drops the planned save; a request on its way goes on. */
  cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  /** Saves now; during a save it only notes that another one must follow. */
  save(): Promise<void> {
    if (!this.options.active()) return Promise.resolve();
    if (this.inflight) {
      this.again = true;
      return Promise.resolve();
    }
    this.cancel();
    const start = this.options.run();
    if (start === 'invalid') return Promise.resolve();
    this.firstPendingAt = null;
    if (start === 'unchanged') return Promise.resolve();
    const sending = start.finally(() => {
      this.inflight = null;
      if (this.again && this.options.active()) {
        this.again = false;
        void this.save();
      }
    });
    this.inflight = sending;
    return sending;
  }

  /** Saves right away and waits until no request is on its way, e.g. before leaving the editor. */
  async flush(): Promise<void> {
    this.cancel();
    await this.save();
    while (this.inflight) await this.inflight.catch(() => undefined);
  }

  private setTimer(ms: number): void {
    const cancel = this.clock.later(() => {
      if (this.cancelTimer === cancel) this.cancelTimer = null;
      void this.save();
    }, ms);
    this.cancelTimer = cancel;
  }
}
