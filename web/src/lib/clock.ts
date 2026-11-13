/** Time and timers behind an interface, so unit tests can move time by hand. */
export interface Clock {
  now(): number;
  /** Runs `callback` once after `ms`; returns the function that cancels it. */
  later(callback: () => void, ms: number): () => void;
  /** Runs `callback` every `ms`; returns the function that stops it. */
  every(callback: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  later: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
  every: (callback, ms) => {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  },
};
