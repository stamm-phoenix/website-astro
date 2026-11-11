/**
 * Fresh demo data for every browser test (#570). `scripts/serve-built.ts --fresh-state` answers
 * `/api/*` and `/.auth/*` from the current instance of the demo API (`scripts/mock-instance.ts`,
 * a worker thread with its own module graph) and swaps in a new one when a test starts. The next
 * instance is loaded while the current test runs, so the swap does not wait for it.
 *
 * Each Playwright worker has its own server and runs one test at a time, so the current instance
 * belongs to exactly one test: its pages, further browser contexts and API requests all see the
 * same data, and no other test can change it. The former instance stops after a grace period, so
 * a request of the previous test still in flight finishes instead of failing.
 */
export interface MockInstance {
  port: number;
  stop: () => void;
}

export type Schedule = (task: () => void, ms: number) => unknown;

/** Long enough for the slowest demo write (900 ms delay) that was already under way. */
export const GRACE_MS = 10_000;

/** Marks a promise as handled; awaiting it later still throws. */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

export class FreshMockState {
  #current: Promise<MockInstance>;
  #spare: Promise<MockInstance>;
  readonly #spawn: () => Promise<MockInstance>;
  readonly #schedule: Schedule;
  readonly #graceMs: number;

  constructor(
    spawn: () => Promise<MockInstance>,
    schedule: Schedule = setTimeout,
    graceMs = GRACE_MS
  ) {
    this.#spawn = spawn;
    this.#schedule = schedule;
    this.#graceMs = graceMs;
    this.#current = quiet(spawn());
    this.#spare = quiet(spawn());
  }

  /** The port of the current instance. */
  async port(): Promise<number> {
    return (await this.#current).port;
  }

  /**
   * Makes the loaded spare the current instance, starts loading the next spare and stops the
   * former instance after the grace period. Resolves with the new port; rejects when the new
   * instance failed to start (the next call starts another one).
   */
  async fresh(): Promise<number> {
    const former = this.#current;
    this.#current = this.#spare;
    this.#spare = quiet(this.#spawn());
    former.then(
      (instance) => this.#schedule(() => instance.stop(), this.#graceMs),
      () => undefined
    );
    return (await this.#current).port;
  }

  /** Stops the current instance and the spare at once. */
  async close(): Promise<void> {
    const instances = await Promise.allSettled([this.#current, this.#spare]);
    for (const result of instances) if (result.status === 'fulfilled') result.value.stop();
  }
}
