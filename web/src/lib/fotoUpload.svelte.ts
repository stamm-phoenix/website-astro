import { ApiError, errorMessage, sendApi } from './api';
import type { FotoAktion } from './fotoAktionen';
import { forgetFotoFolder } from './fotoOrdnerStore.svelte';

export { selectFotoFiles, type FotoSelection } from './fotoAuswahl';
import { uploadName } from './fotoAuswahl';
import { numberedName } from './fotoPfade';
import type { FotoTarget, FotoUploadSession } from './types';

/**
 * Upload of many photos and videos into the photo library. The API creates the folder and an
 * upload session per file; the browser then sends each file in parts directly to SharePoint.
 * Lost connections are waited out and the file continues where SharePoint stopped receiving,
 * so a train tunnel or a switch between mobile data and Wi-Fi loses nothing. Closing the tab
 * ends the upload; files that arrived completely stay in SharePoint.
 */

export type FotoUploadStatus = 'waiting' | 'uploading' | 'done' | 'skipped' | 'failed';

export interface FotoUploadItem {
  id: number;
  name: string;
  size: number;
  status: FotoUploadStatus;
  /** Bytes SharePoint has received. */
  sent: number;
  error: string | null;
}

/** Where the files go: an Aktion (`<Jahr>/<Aktion>/<Vorname>`) or a folder chosen freely. */
export type FotoTargetRequest =
  { jahr: string; aktion: string } | { pfad: string; unterordner?: string };

export type FotoUploadPhase = 'idle' | 'preparing' | 'running' | 'finished' | 'cancelled' | 'error';

interface FotoUploadState {
  phase: FotoUploadPhase;
  items: FotoUploadItem[];
  target: FotoTarget | null;
  /** Shown in the summary, e.g. the name of the Aktion. */
  label: string;
  /** Why the upload is waiting; several files may wait at the same time. */
  waits: { offline: number; login: number; retry: number };
  /** Why the folder could not be prepared (phase `error`). */
  error: string | null;
  /** Measured over the last seconds; null until known. */
  bytesPerSecond: number | null;
}

export const fotoUpload = $state<FotoUploadState>({
  phase: 'idle',
  items: [],
  target: null,
  label: '',
  waits: { offline: 0, login: 0, retry: 0 },
  error: null,
  bytesPerSecond: null,
});

/**
 * What the upload form holds before the upload starts. It lives here, not in the form, so that
 * switching to the photo view and back or a failed preparation keeps the chosen files.
 */
export interface FotoUploadDraft {
  files: File[];
  mode: 'aktion' | 'ordner';
  aktion: FotoAktion | null;
  /** Folder of the free choice; empty for the top folder. */
  folder: string;
  subfolder: string;
}

export const fotoUploadDraft = $state<FotoUploadDraft>({
  files: [],
  mode: 'aktion',
  aktion: null,
  folder: '',
  subfolder: '',
});

/** Whether files are chosen but not being uploaded, e.g. to warn before leaving the page. */
export function hasFotoDraft(): boolean {
  switch (fotoUpload.phase) {
    case 'idle':
      return fotoUploadDraft.files.length > 0;
    case 'error':
    case 'cancelled':
      return true;
    case 'finished':
      return fotoUpload.items.some((item) => item.status === 'failed' || item.status === 'waiting');
    default:
      return false;
  }
}

/** Presets the free choice with a folder, e.g. from „Hierher hochladen“; keeps chosen files. */
export function presetFotoFolder(path: string): void {
  fotoUploadDraft.mode = 'ordner';
  fotoUploadDraft.folder = path;
  fotoUploadDraft.subfolder = '';
}

/** Files uploaded at the same time; more does not get faster on a phone. */
const PARALLEL_FILES = 3;
/** Size of the parts; SharePoint wants multiples of 320 KiB. */
const CHUNK_BYTES = 16 * 320 * 1024;
/** Failed attempts per file while online, before it is marked as failed. */
const MAX_ATTEMPTS = 12;
const MAX_RESTARTS = 4;
const MAX_WAIT_MS = 30_000;
/** A part that makes no progress for this long counts as a lost connection. */
const STALL_TIMEOUT_MS = 5 * 60_000;

const NO_CONNECTION =
  'Keine Verbindung zu SharePoint. Prüfe dein Internet und tippe auf „Erneut versuchen“.';

class CancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'CancelledError';
  }
}

/** The upload session is gone: expired, or completed while the answer got lost. */
class SessionLostError extends Error {
  constructor() {
    super('Upload session lost');
    this.name = 'SessionLostError';
  }
}

interface Run {
  controller: AbortController;
  request: FotoTargetRequest;
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the files themselves, never rendered
const files = new Map<number, File>();
let nextId = 1;
let run: Run | null = null;
let resumeLogin: (() => void) | null = null;
let loginWait: Promise<void> | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
let speedTimer: ReturnType<typeof setInterval> | null = null;

export const uploadTotals = {
  get bytes(): number {
    return fotoUpload.items.reduce((sum, item) => sum + item.size, 0);
  },
  get sent(): number {
    return fotoUpload.items.reduce(
      (sum, item) => sum + (item.status === 'failed' ? 0 : item.sent),
      0
    );
  },
};

function isActive(): boolean {
  return fotoUpload.phase === 'preparing' || fotoUpload.phase === 'running';
}

/** Whether an upload is running, e.g. to warn before leaving the page. */
export function fotoUploadActive(): boolean {
  return isActive();
}

/** Starts the upload of the files into the target; the folder is created if missing. */
export function startFotoUpload(selected: File[], request: FotoTargetRequest, label: string): void {
  if (isActive()) return;
  files.clear();
  // Files of the same name get numbers, so they do not claim the same name in SharePoint
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this function
  const taken = new Set<string>();
  fotoUpload.items = selected.map((file, index) => {
    const id = nextId++;
    files.set(id, file);
    let name = uploadName(file, index);
    for (let number = 1; taken.has(name.toLowerCase()); number++) {
      name = numberedName(uploadName(file, index), number);
    }
    taken.add(name.toLowerCase());
    return {
      id,
      name,
      size: file.size,
      status: 'waiting' as const,
      sent: 0,
      error: null,
    };
  });
  fotoUpload.label = label;
  fotoUpload.target = null;
  void begin({ controller: new AbortController(), request });
}

/** Tries the failed files again (or the preparation of the folder, if that failed). */
export function retryFotoUpload(): void {
  if (isActive() || !run) return;
  for (const item of fotoUpload.items) {
    if (item.status === 'failed') {
      item.status = 'waiting';
      item.error = null;
      item.sent = 0;
    }
  }
  void begin({ controller: new AbortController(), request: run.request });
}

/** Stops the upload; files that arrived completely stay in SharePoint. */
export function cancelFotoUpload(): void {
  run?.controller.abort();
}

/** Continues after a new login in another tab. */
export function continueFotoUpload(): void {
  resumeLogin?.();
}

/**
 * Clears a finished or cancelled upload for the next one. With `keepSelection` the chosen files
 * stay in the form, e.g. to correct the target after the folder could not be created.
 */
export function resetFotoUpload({ keepSelection = false } = {}): void {
  if (isActive()) return;
  if (!keepSelection) fotoUploadDraft.files = [];
  files.clear();
  run = null;
  fotoUpload.phase = 'idle';
  fotoUpload.items = [];
  fotoUpload.target = null;
  fotoUpload.error = null;
  fotoUpload.label = '';
}

async function begin(next: Run): Promise<void> {
  run = next;
  const { signal } = next.controller;
  fotoUpload.error = null;
  fotoUpload.bytesPerSecond = null;
  fotoUpload.waits = { offline: 0, login: 0, retry: 0 };
  startKeepAwake();

  try {
    if (!fotoUpload.target) {
      fotoUpload.phase = 'preparing';
      fotoUpload.target = await callApi(next, () =>
        sendApi<FotoTarget>('POST', '/intern/fotos/ziel', next.request, { signal })
      );
    }
    fotoUpload.phase = 'running';
    await Promise.all(Array.from({ length: PARALLEL_FILES }, () => worker(next)));
    fotoUpload.phase = signal.aborted ? 'cancelled' : 'finished';
    // The photo view shows the new files next time, also if it was open meanwhile
    if (fotoUpload.target) forgetFotoFolder(fotoUpload.target.path);
  } catch (error: unknown) {
    if (signal.aborted) {
      fotoUpload.phase = 'cancelled';
    } else {
      fotoUpload.phase = 'error';
      fotoUpload.error = errorMessage(
        error,
        'Der Ordner für die Fotos konnte nicht angelegt werden. Es wurde noch nichts hochgeladen. Tippe auf „Erneut versuchen“.'
      );
    }
  } finally {
    stopKeepAwake();
  }
}

async function worker(current: Run): Promise<void> {
  const { signal } = current.controller;
  for (;;) {
    if (signal.aborted) return;
    const item = fotoUpload.items.find((entry) => entry.status === 'waiting');
    if (!item) return;
    item.status = 'uploading';
    try {
      await uploadItem(current, item);
    } catch (error: unknown) {
      if (signal.aborted) {
        item.status = 'waiting';
        item.sent = 0;
        return;
      }
      item.status = 'failed';
      item.sent = 0;
      item.error =
        error instanceof ApiError
          ? errorMessage(error, NO_CONNECTION)
          : error instanceof Error && error.message.startsWith('SharePoint')
            ? error.message
            : NO_CONNECTION;
    }
  }
}

async function uploadItem(current: Run, item: FotoUploadItem): Promise<void> {
  const file = files.get(item.id);
  const target = fotoUpload.target;
  if (!file || !target) throw new Error('Missing file');
  for (let restart = 0; ; restart++) {
    const session = await callApi(current, () =>
      sendApi<FotoUploadSession>(
        'POST',
        '/intern/fotos/upload',
        {
          pfad: target.path,
          name: item.name,
          size: item.size,
        },
        { signal: current.controller.signal }
      )
    );
    // A taken name gets a free one; keeping it lets a restart find the file it already sent
    item.name = session.name;
    if (session.exists) {
      item.sent = item.size;
      // After a lost session the file found is the one just sent
      item.status = restart > 0 ? 'done' : 'skipped';
      return;
    }
    try {
      await sendFile(current, item, file, session.uploadUrl);
      item.sent = item.size;
      item.status = 'done';
      return;
    } catch (error: unknown) {
      if (!(error instanceof SessionLostError) || restart >= MAX_RESTARTS) throw error;
    }
  }
}

interface ChunkAnswer {
  status: number;
  body: unknown;
}

/** First byte SharePoint still expects, from `nextExpectedRanges` (`["5242880-"]`). */
function expectedOffset(body: unknown): number | null {
  const ranges = (body as { nextExpectedRanges?: unknown } | null)?.nextExpectedRanges;
  if (!Array.isArray(ranges) || typeof ranges[0] !== 'string') return null;
  const start = Number.parseInt(ranges[0], 10);
  return Number.isFinite(start) ? start : null;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function sendFile(
  current: Run,
  item: FotoUploadItem,
  file: File,
  url: string
): Promise<void> {
  let offset = 0;
  let failures = 0;

  const recover = async (): Promise<void> => {
    failures++;
    if (failures > MAX_ATTEMPTS) throw new Error(NO_CONNECTION);
    await pause(current, failures);
    offset = await sessionOffset(current, url);
    item.sent = offset;
  };

  for (;;) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    let answer: ChunkAnswer;
    try {
      answer = await putChunk(current, url, file, offset, end, (loaded) => {
        item.sent = offset + loaded;
      });
    } catch (error: unknown) {
      if (current.controller.signal.aborted) throw new CancelledError();
      if (error instanceof SessionLostError) throw error;
      await recover();
      continue;
    }

    if (answer.status === 200 || answer.status === 201) return;
    // 404: the session is gone; 409: another file took the name meanwhile. A new session finds
    // the file if it arrived, or gives it the next free name.
    if (answer.status === 404 || answer.status === 409) throw new SessionLostError();
    if (answer.status === 202) {
      failures = 0;
      offset = expectedOffset(answer.body) ?? end;
      item.sent = offset;
      if (offset < file.size) continue;
      // Everything sent but not completed: ask where SharePoint stands
      await recover();
      continue;
    }
    if (answer.status === 416 || isTransientStatus(answer.status)) {
      await recover();
      continue;
    }
    throw new Error(
      `SharePoint hat „${item.name}“ nicht angenommen (Fehler ${answer.status}). Tippe auf „Erneut versuchen“. Wenn es wieder nicht klappt, schreib an it@stamm-phoenix.de.`
    );
  }
}

/** Sends one part with progress; rejects on a lost connection or when cancelled. */
function putChunk(
  current: Run,
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

/** Asks SharePoint which byte it expects next, waiting out lost connections. */
async function sessionOffset(current: Run, url: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        signal: current.controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.status === 404) throw new SessionLostError();
      if (response.ok) {
        const offset = expectedOffset(await response.json());
        // No range left: completed, but the answer to the last part got lost
        if (offset === null) throw new SessionLostError();
        return offset;
      }
      if (!isTransientStatus(response.status)) throw new SessionLostError();
    } catch (error: unknown) {
      if (current.controller.signal.aborted) throw new CancelledError();
      if (error instanceof SessionLostError) throw error;
    }
    if (attempt > MAX_ATTEMPTS) throw new Error(NO_CONNECTION);
    await pause(current, attempt);
  }
}

/**
 * Calls the API, waiting out lost connections and server errors, and an expired login until
 * the user has logged in again.
 */
async function callApi<T>(current: Run, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (current.controller.signal.aborted) throw new CancelledError();
    try {
      return await call();
    } catch (error: unknown) {
      if (current.controller.signal.aborted) throw new CancelledError();
      if (error instanceof ApiError && error.status === 401) {
        await waitForLogin(current);
        continue;
      }
      const transient = !(error instanceof ApiError) || isTransientStatus(error.status);
      if (!transient || attempt > MAX_ATTEMPTS) throw error;
      await pause(current, attempt);
    }
  }
}

/** Waits for the connection to come back, or a growing time before the next attempt. */
async function pause(current: Run, attempt: number): Promise<void> {
  const { signal } = current.controller;
  if (!navigator.onLine) {
    fotoUpload.waits.offline++;
    try {
      await waitFor(signal, (resolve) => {
        window.addEventListener('online', resolve, { once: true });
        return () => window.removeEventListener('online', resolve);
      });
    } finally {
      fotoUpload.waits.offline--;
    }
    return;
  }
  fotoUpload.waits.retry++;
  try {
    const delay = Math.min(MAX_WAIT_MS, 1000 * 2 ** (attempt - 1));
    await waitFor(signal, (resolve) => {
      const timer = setTimeout(resolve, delay);
      // Coming back online is a good moment to try at once
      window.addEventListener('online', resolve, { once: true });
      return () => {
        clearTimeout(timer);
        window.removeEventListener('online', resolve);
      };
    });
  } finally {
    fotoUpload.waits.retry--;
  }
}

/** Waits until `continueFotoUpload()`; all files share one wait. */
async function waitForLogin(current: Run): Promise<void> {
  if (!loginWait) {
    loginWait = new Promise<void>((resolve) => {
      resumeLogin = () => {
        resumeLogin = null;
        loginWait = null;
        resolve();
      };
    });
  }
  const wait = loginWait;
  fotoUpload.waits.login++;
  try {
    await waitFor(current.controller.signal, (resolve) => {
      void wait.then(resolve);
      return () => undefined;
    });
  } finally {
    fotoUpload.waits.login--;
  }
}

function waitFor(signal: AbortSignal, setup: (resolve: () => void) => () => void): Promise<void> {
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

/** Keeps the phone's screen on while uploading: a locked phone stops the upload. */
function startKeepAwake(): void {
  void requestWakeLock();
  document.addEventListener('visibilitychange', onVisibilityChange);
  let lastSent = uploadTotals.sent;
  let lastTime = performance.now();
  if (speedTimer) clearInterval(speedTimer);
  speedTimer = setInterval(() => {
    const sent = uploadTotals.sent;
    const now = performance.now();
    const current = Math.max(0, sent - lastSent) / ((now - lastTime) / 1000);
    lastSent = sent;
    lastTime = now;
    const previous = fotoUpload.bytesPerSecond;
    fotoUpload.bytesPerSecond = previous === null ? current : previous * 0.7 + current * 0.3;
  }, 2000);
}

function stopKeepAwake(): void {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (speedTimer) clearInterval(speedTimer);
  speedTimer = null;
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

function onVisibilityChange(): void {
  // The browser releases the lock when the page is hidden
  if (document.visibilityState === 'visible' && isActive()) void requestWakeLock();
}

async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
  };
  try {
    const lock = (await nav.wakeLock?.request('screen')) ?? null;
    // The upload may have ended while the lock was being granted
    if (lock && !isActive()) void lock.release().catch(() => undefined);
    else if (lock) {
      void wakeLock?.release().catch(() => undefined);
      wakeLock = lock;
    }
  } catch {
    // Not supported or not allowed (e.g. battery saver); the upload works anyway
  }
}
