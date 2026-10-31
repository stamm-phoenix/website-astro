/** Time limits and abort handling of browser requests to the API (`api.ts`). */

/** How long a request may take before it is given up, by what it does. */
export const TIMEOUT_MS = {
  /** Reading JSON. */
  read: 30_000,
  /** Writing JSON. */
  write: 60_000,
  /** Files and uploads, which are larger. */
  file: 120_000,
} as const;

export const READ_TIMEOUT_MESSAGE =
  'Der Server hat nicht rechtzeitig geantwortet. Prüfe deine Internetverbindung und versuche es erneut.';

export const WRITE_TIMEOUT_MESSAGE =
  'Der Server hat nicht rechtzeitig geantwortet. Vielleicht wurde deine Änderung trotzdem gespeichert: Lade die Seite neu und prüfe es, bevor du sie noch einmal sendest.';

export interface Deadline {
  signal: AbortSignal;
  /** True once the time limit, not the caller, ended the request. */
  timedOut(): boolean;
  /** Stops the timer after the request has settled. */
  clear(): void;
}

/** A signal that aborts after `ms` or when the caller's `signal` aborts, whichever is first. */
export function deadline(ms: number, signal?: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onCallerAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener('abort', onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}
