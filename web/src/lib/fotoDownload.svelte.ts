import { MAX_ZIP_BYTES, MAX_ZIP_FILES, buildZip, downloadForZip, type ZipFile } from './fotoZip';
import { ApiError, errorMessage, fetchApi } from './api';
import type { FotoFile, FotoFileDetail } from './types';

/** Download of several photos as one ZIP archive, built in the browser. */

interface FotoDownloadState {
  phase: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  files: number;
  doneFiles: number;
  bytes: number;
  doneBytes: number;
  message: string | null;
}

export const fotoDownload = $state<FotoDownloadState>({
  phase: 'idle',
  files: 0,
  doneFiles: 0,
  bytes: 0,
  doneBytes: 0,
  message: null,
});

const PARALLEL = 3;
/** Links older than this are renewed before use; the folder was loaded fresh at the start. */
const LINK_MAX_AGE_MS = 40 * 60_000;
const ATTEMPTS = 3;

let controller: AbortController | null = null;

/** Why a selection cannot be packed, or null if it can. */
export function zipLimitMessage(bytes: number, count = 0): string | null {
  if (count > MAX_ZIP_FILES) {
    return 'Das sind zu viele Dateien für einen Download auf einmal (höchstens 65.535). Wähle weniger Fotos aus oder lade den Ordner in SharePoint herunter.';
  }
  if (bytes <= MAX_ZIP_BYTES) return null;
  return 'Das ist zu viel für einen Download auf einmal (höchstens 1 GB). Wähle weniger Fotos aus oder lade den Ordner in SharePoint herunter.';
}

/** Saves a file the browser already holds, e.g. a ZIP built here. */
export function saveBlobUrl(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Shown when SharePoint refuses a single download, e.g. for a file deleted meanwhile. */
function downloadFailedMessage(name: string): string {
  return `„${name}“ konnte nicht heruntergeladen werden. Vielleicht wurde die Datei in SharePoint gelöscht oder verschoben. Lade den Ordner neu und versuch es noch einmal. Klappt es dann nicht, schreib an it@stamm-phoenix.de.`;
}

/** Files up to this size are fetched first and saved from memory; larger ones go directly. */
const FETCH_SAVE_MAX_BYTES = 300 * 1024 ** 2;

/**
 * Saves one file from SharePoint without leaving the page: a link to SharePoint would navigate
 * away (and stop a playing video), so the file is fetched and saved from memory, or for large
 * files handed to a hidden frame, where SharePoint sends it as a download.
 */
export async function saveFotoFile(url: string, name: string, size: number): Promise<void> {
  if (size <= FETCH_SAVE_MAX_BYTES) {
    let response: Response | null = null;
    try {
      response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    } catch {
      // Blocked or interrupted before an answer: the frame below may still work
    }
    // An answer with an error status is final; the frame would only load the error page
    if (response && !response.ok) throw new Error(downloadFailedMessage(name));
    if (response) {
      try {
        const blobUrl = URL.createObjectURL(await response.blob());
        saveBlobUrl(blobUrl, name);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return;
      } catch {
        // Interrupted while loading: try the frame below
      }
    }
  }
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = url;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 5 * 60_000);
}

/**
 * Downloads the files and saves them as `<archiveName>.zip`. The download links must be fresh
 * (at most about an hour old).
 */
export async function downloadFotosAsZip(files: FotoFile[], archiveName: string): Promise<void> {
  if (fotoDownload.phase === 'running') return;
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const limit = zipLimitMessage(bytes, files.length);
  Object.assign(fotoDownload, {
    phase: 'running',
    files: files.length,
    doneFiles: 0,
    bytes,
    doneBytes: 0,
    message: null,
  });
  if (limit) {
    Object.assign(fotoDownload, { phase: 'error', message: limit });
    return;
  }
  controller = new AbortController();
  const { signal } = controller;
  const entries: ZipFile[] = new Array(files.length);
  let next = 0;

  const startedAt = Date.now();
  /** More arrived than a phone can hold; everything received is dropped. */
  let tooLarge = false;
  /**
   * A link that may have expired: SharePoint's links last about an hour, and a long ZIP or a
   * failed attempt may be past that. A fresh one comes from the details of the file.
   */
  const freshLink = async (file: FotoFile, attempt: number): Promise<string | null> => {
    if (attempt === 1 && Date.now() - startedAt < LINK_MAX_AGE_MS) return file.downloadUrl;
    const detail = await fetchApi<FotoFileDetail>(
      `/intern/fotos/dateien/${encodeURIComponent(file.id)}`,
      signal
    );
    return detail.downloadUrl;
  };

  const fetchOne = async (file: FotoFile): Promise<ZipFile> => {
    for (let attempt = 1; ; attempt++) {
      let received = 0;
      try {
        const url = await freshLink(file, attempt);
        if (!url) throw new Error('No download link');
        const { data, crc } = await downloadForZip(url, signal, (count) => {
          received += count;
          fotoDownload.doneBytes += count;
          // The sizes in the list may be old, e.g. a video replaced by a longer one meanwhile
          if (fotoDownload.doneBytes > MAX_ZIP_BYTES) {
            tooLarge = true;
            controller?.abort();
          }
        });
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- only written into the archive
        const modified = new Date(file.takenAt ?? file.modifiedAt ?? Date.now());
        return { name: file.name, data, crc, modified };
      } catch (error: unknown) {
        fotoDownload.doneBytes -= received;
        // An expired login needs a new one; trying again would not help
        const loginExpired = error instanceof ApiError && error.status === 401;
        if (signal.aborted || loginExpired || attempt >= ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  };

  let failed = false;
  /** The first error that stopped the download, to say what went wrong. */
  let cause: unknown = null;
  try {
    // A file that fails for good stops the others; all of them have ended before the next
    // download can start, so none of them changes its progress
    await Promise.allSettled(
      Array.from({ length: PARALLEL }, async () => {
        while (next < files.length && !signal.aborted) {
          const index = next++;
          try {
            entries[index] = await fetchOne(files[index]);
            fotoDownload.doneFiles++;
          } catch (error: unknown) {
            if (!signal.aborted) {
              failed = true;
              cause ??= error;
            }
            controller?.abort();
            throw error;
          }
        }
      })
    );
    if (failed || tooLarge) throw new Error('A file could not be downloaded');
    if (signal.aborted) {
      Object.assign(fotoDownload, { phase: 'cancelled', message: 'Download abgebrochen.' });
      return;
    }
    const url = URL.createObjectURL(buildZip(entries));
    saveBlobUrl(url, `${archiveName}.zip`);
    // Give the browser time to start saving before the memory is freed
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    Object.assign(fotoDownload, {
      phase: 'done',
      message: `${files.length} Dateien als ZIP gespeichert. Du findest sie bei deinen Downloads.`,
    });
  } catch {
    if (tooLarge) {
      Object.assign(fotoDownload, { phase: 'error', message: zipLimitMessage(Infinity) });
      return;
    }
    if (!failed && signal.aborted) {
      Object.assign(fotoDownload, { phase: 'cancelled', message: 'Download abgebrochen.' });
      return;
    }
    Object.assign(fotoDownload, {
      phase: 'error',
      // An answer of the API (e.g. an expired login) says itself what to do
      message: errorMessage(
        cause,
        'Der Download als ZIP hat nicht geklappt. Prüfe deine Internetverbindung und versuche es noch einmal, oder lade die Fotos einzeln oder in SharePoint herunter.'
      ),
    });
  } finally {
    controller = null;
  }
}

export function cancelFotoDownload(): void {
  controller?.abort();
}
