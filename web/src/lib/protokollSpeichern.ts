/**
 * Decisions of the automatic saving in the Protokoll editor, without timers or requests, so they
 * can be tested on their own. The session (`protokollEditorSession.svelte.ts`) acts on them.
 */
import { ApiError } from './apiError';
import { formatTime } from './protokollEditor';

/** Quiet time after the last keystroke before saving, and the longest wait while typing. */
export const SAVE_DELAY_MS = 1000;
export const SAVE_MAX_WAIT_MS = 5000;
/** Waits before the next attempt while offline; the last one repeats. */
export const RETRY_MS: readonly number[] = [2000, 5000, 10_000, 20_000, 30_000];
/** How often readers check for changes while the page is visible. */
export const POLL_MS = 2500;

export type SaveState = 'gespeichert' | 'ungespeichert' | 'speichert' | 'offline' | 'fehler';

/** What to do after a failed save. */
export type SaveFailure =
  /** Offline or a hiccup of the server: try again later; the changes are on this device. */
  | { kind: 'retry' }
  /** Another tab took over, or the minutes changed elsewhere. */
  | { kind: 'lostLock' }
  /** The minutes can no longer be written (e.g. given to the review); the server says why. */
  | { kind: 'notEditable'; message: string }
  /** Nothing to retry: shown next to „Erneut speichern“. */
  | { kind: 'fatal'; message: string };

/** Sorts a failed save by what the editor does next. */
export function classifySaveError(error: unknown): SaveFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
    return { kind: 'retry' };
  }
  if (error.status === 423 || (error.status === 409 && error.code === 'CONFLICT')) {
    return { kind: 'lostLock' };
  }
  if (error.status === 409 && error.code === 'NOT_EDITABLE') {
    return { kind: 'notEditable', message: error.message };
  }
  if (error.status === 404) {
    return {
      kind: 'fatal',
      message: 'Das Protokoll wurde gelöscht. Deine Änderungen sind auf diesem Gerät gesichert.',
    };
  }
  return {
    kind: 'fatal',
    message:
      error.status === 401
        ? 'Bitte neu anmelden. Deine Änderungen sind auf diesem Gerät gesichert.'
        : error.fields
          ? Object.values(error.fields).join(' ')
          : error.message,
  };
}

/**
 * Milliseconds until the save of a change: the quiet time, but never later than the longest wait
 * counted from the first change that is not saved yet.
 */
export function saveWait(delay: number, firstPendingAt: number, now: number): number {
  return Math.min(delay, Math.max(0, firstPendingAt + SAVE_MAX_WAIT_MS - now));
}

/** Wait before the attempt after `failures` failed ones in a row. */
export function retryDelay(failures: number): number {
  return RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
}

/** The text of the status bar while writing. */
export function saveStatusText(
  state: SaveState,
  lastSavedAt: string | null,
  saveError: string | null
): string {
  switch (state) {
    case 'gespeichert':
      return lastSavedAt ? `Gespeichert um ${formatTime(lastSavedAt)}` : 'Gespeichert';
    case 'ungespeichert':
      return 'Änderungen werden gleich gespeichert …';
    case 'speichert':
      return 'Speichert …';
    case 'offline':
      return 'Offline – Änderungen sind auf diesem Gerät gesichert';
    default:
      return saveError ?? 'Nicht gespeichert';
  }
}
