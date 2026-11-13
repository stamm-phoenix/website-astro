/** Stateless parts of the photo upload (`fotoUpload.svelte.ts`): errors, limits and the requests to SharePoint. */

/** Files uploaded at the same time; more does not get faster on a phone. */
export const PARALLEL_FILES = 3;
/** Size of the parts; SharePoint wants multiples of 320 KiB. */
export const CHUNK_BYTES = 16 * 320 * 1024;
/** Failed attempts per file while online, before it is marked as failed. */
export const MAX_ATTEMPTS = 12;
export const MAX_RESTARTS = 4;
export const MAX_WAIT_MS = 30_000;
/** A part that makes no progress for this long counts as a lost connection. */
export const STALL_TIMEOUT_MS = 5 * 60_000;

export const NO_CONNECTION =
  'Keine Verbindung zu SharePoint. Prüfe dein Internet und tippe auf „Erneut versuchen“.';

export class CancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'CancelledError';
  }
}

/** The upload session is gone: expired, or completed while the answer got lost. */
export class SessionLostError extends Error {
  constructor() {
    super('Upload session lost');
    this.name = 'SessionLostError';
  }
}

/** Someone else's file took the name while this one was uploading. */
export class NameTakenError extends SessionLostError {
  constructor() {
    super();
    this.name = 'NameTakenError';
  }
}

export interface ChunkAnswer {
  status: number;
  body: unknown;
}

/** First byte SharePoint still expects, from `nextExpectedRanges` (`["5242880-"]`). */
export function expectedOffset(body: unknown): number | null {
  const ranges = (body as { nextExpectedRanges?: unknown } | null)?.nextExpectedRanges;
  if (!Array.isArray(ranges) || typeof ranges[0] !== 'string') return null;
  const start = Number.parseInt(ranges[0], 10);
  return Number.isFinite(start) ? start : null;
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Sends one part with progress; rejects on a lost connection or when cancelled. */
export function putChunk(
  current: { controller: AbortController },
  url: string,
  file: File,
  start: number,
  end: number,
  onProgress: (loaded: number) => void
): Promise<ChunkAnswer> {
  return new Promise((resolve, reject) => {
    const { signal } = current.controller;
    if (signal.aborted) return reject(new CancelledError());
    const xhr = new XMLHttpRequest();
    const abort = (): void => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    // Only a part without any progress counts as lost: a slow connection may need longer
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const watch = (): void => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };
    const done = (): void => {
      clearTimeout(watchdog);
      signal.removeEventListener('abort', abort);
    };
    // No login: the URL itself grants the upload
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${file.size}`);
    xhr.upload.onprogress = (event) => {
      watch();
      onProgress(event.loaded);
    };
    xhr.onload = () => {
      done();
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // Not JSON; the status decides
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => {
      done();
      reject(new Error('Network error'));
    };
    xhr.onabort = () => {
      done();
      reject(stalled ? new Error('Upload stalled') : new CancelledError());
    };
    watch();
    xhr.send(file.slice(start, end));
  });
}

export function waitFor(
  signal: AbortSignal,
  setup: (resolve: () => void) => () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError());
    let cleanup = (): void => undefined;
    const finish = (): void => {
      cleanup();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      finish();
      reject(new CancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    cleanup = setup(() => {
      finish();
      resolve();
    });
  });
}
