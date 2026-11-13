import {
  type FotoUploadItem,
  type FotoTargetRequest,
  fotoUpload,
  fotoUploadDraft,
} from './fotoUploadState.svelte';
import {
  PARALLEL_FILES,
  CHUNK_BYTES,
  MAX_ATTEMPTS,
  MAX_RESTARTS,
  MAX_WAIT_MS,
  NO_CONNECTION,
  CancelledError,
  SessionLostError,
  NameTakenError,
  type ChunkAnswer,
  expectedOffset,
  isTransientStatus,
  putChunk,
  waitFor,
} from './fotoUploadTransport';
import { HELP_CONTACTS } from './helpContacts';
import type { FotoTarget } from './types/staff';
import { ApiError, errorMessage, sendApi } from './api';
import { startKeepAwake, stopKeepAwake } from './fotoUploadKeepAwake';
import { isActive } from './fotoUploadState.svelte';
import { forgetFotoFolder } from './fotoOrdnerStore.svelte';

export { selectFotoFiles, type FotoSelection } from './fotoAuswahl';
import { uploadName } from './fotoAuswahl';
import { fotoNameCandidates, numberedName } from './fotoPfade';
import type { FotoUploadSession } from '../../../api/lib/fotos-model';

/**
 * Upload of many photos and videos into the photo library. The API creates the folder and an
 * upload session per file; the browser then sends each file in parts directly to SharePoint.
 * Lost connections are waited out and the file continues where SharePoint stopped receiving,
 * so a train tunnel or a switch between mobile data and Wi-Fi loses nothing. Closing the tab
 * ends the upload; files that arrived completely stay in SharePoint.
 */

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
  fotoUpload.notified = null;
  void begin({ controller: new AbortController(), request });
}

/** Names of the files this upload brought into the folder that the leaders were not told about. */
export function unnotifiedFotoNames(): string[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this function
  const told = new Set(fotoUpload.notified?.names ?? []);
  return fotoUpload.items
    .filter((item) => item.status === 'done' && !told.has(item.name))
    .map((item) => item.name);
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
 * Clears a finished or cancelled upload for the next one. With `keepSelection` the files that did
 * not arrive stay in the form, e.g. to correct the target after the folder could not be created.
 */
export function resetFotoUpload({ keepSelection = false } = {}): void {
  if (isActive()) return;
  if (keepSelection) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this function
    const arrived = new Set(
      fotoUpload.items
        .filter((item) => item.status === 'done' || item.status === 'skipped')
        .map((item) => files.get(item.id))
    );
    fotoUploadDraft.files = fotoUploadDraft.files.filter((file) => !arrived.has(file));
  } else fotoUploadDraft.files = [];
  files.clear();
  run = null;
  fotoUpload.phase = 'idle';
  fotoUpload.items = [];
  fotoUpload.target = null;
  fotoUpload.error = null;
  fotoUpload.label = '';
  fotoUpload.notified = null;
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
  let newName = false;
  for (let restart = 0; ; restart++) {
    // Names of the other files of this upload, also of those not arrived yet, are never taken
    // over: a file of the same name and size there is another photo, not this one
    const others = new Set(
      fotoUpload.items.filter((other) => other !== item).map((other) => other.name.toLowerCase())
    );
    const reserved = fotoNameCandidates(item.name).filter((name) => others.has(name.toLowerCase()));
    const session = await callApi(current, () =>
      sendApi<FotoUploadSession>(
        'POST',
        '/intern/fotos/upload',
        {
          pfad: target.path,
          name: item.name,
          size: item.size,
          ...(newName ? { neu: true } : {}),
          ...(reserved.length ? { belegt: reserved } : {}),
        },
        { signal: current.controller.signal }
      )
    );
    newName = false;
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
      // The file found under the name now is someone else's
      newName = error instanceof NameTakenError;
    }
  }
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
    // 404: the session is gone; a new one finds the file if it arrived. 409: another file took
    // the name meanwhile; the new session gets the next free name.
    if (answer.status === 404) throw new SessionLostError();
    if (answer.status === 409) throw new NameTakenError();
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
      `SharePoint hat „${item.name}“ nicht angenommen (Fehler ${answer.status}). Tippe auf „Erneut versuchen“. Wenn es wieder nicht klappt, schreib an ${HELP_CONTACTS.technik}.`
    );
  }
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
