import { MAX_ZIP_BYTES, buildZip, downloadForZip, type ZipFile } from './fotoZip';
import type { FotoFile } from './types';

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
const ATTEMPTS = 3;

let controller: AbortController | null = null;

/** Why a selection cannot be packed, or null if it can. */
export function zipLimitMessage(bytes: number): string | null {
  if (bytes <= MAX_ZIP_BYTES) return null;
  return 'Das ist zu viel für einen Download auf einmal (höchstens 1 GB). Wähle weniger Fotos aus oder lade den Ordner in SharePoint herunter.';
}

/** Saves a file from a URL; SharePoint's download links send it as an attachment. */
export function saveUrl(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Downloads the files and saves them as `<archiveName>.zip`. The download links must be fresh
 * (at most about an hour old).
 */
export async function downloadFotosAsZip(files: FotoFile[], archiveName: string): Promise<void> {
  if (fotoDownload.phase === 'running') return;
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const limit = zipLimitMessage(bytes);
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

  const fetchOne = async (file: FotoFile): Promise<ZipFile> => {
    for (let attempt = 1; ; attempt++) {
      let received = 0;
      try {
        if (!file.downloadUrl) throw new Error('No download link');
        const { data, crc } = await downloadForZip(file.downloadUrl, signal, (count) => {
          received += count;
          fotoDownload.doneBytes += count;
        });
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- only written into the archive
        const modified = new Date(file.takenAt ?? file.modifiedAt ?? Date.now());
        return { name: file.name, data, crc, modified };
      } catch (error: unknown) {
        fotoDownload.doneBytes -= received;
        if (signal.aborted || attempt >= ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  };

  let failed = false;
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
            if (!signal.aborted) failed = true;
            controller?.abort();
            throw error;
          }
        }
      })
    );
    if (failed) throw new Error('A file could not be downloaded');
    if (signal.aborted) {
      Object.assign(fotoDownload, { phase: 'cancelled', message: 'Download abgebrochen.' });
      return;
    }
    const url = URL.createObjectURL(buildZip(entries));
    saveUrl(url, `${archiveName}.zip`);
    // Give the browser time to start saving before the memory is freed
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    Object.assign(fotoDownload, {
      phase: 'done',
      message: `${files.length} Dateien als ZIP gespeichert. Du findest sie bei deinen Downloads.`,
    });
  } catch {
    if (!failed && signal.aborted) {
      Object.assign(fotoDownload, { phase: 'cancelled', message: 'Download abgebrochen.' });
      return;
    }
    Object.assign(fotoDownload, {
      phase: 'error',
      message:
        'Der Download als ZIP hat nicht geklappt. Prüfe deine Internetverbindung und versuche es noch einmal, oder lade die Fotos einzeln oder in SharePoint herunter.',
    });
  } finally {
    controller = null;
  }
}

export function cancelFotoDownload(): void {
  controller?.abort();
}
