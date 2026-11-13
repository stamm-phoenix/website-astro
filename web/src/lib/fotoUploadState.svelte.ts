import { errorMessage, fetchApi } from './api';
import type { FotoAktion } from './fotoAktionen';
import type { FotoTarget } from './types/staff';

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
  /** Files of this upload the leaders were told about, and the addresses of the last note. */
  notified: { recipients: number; names: string[] } | null;
}

export const fotoUpload = $state<FotoUploadState>({
  phase: 'idle',
  items: [],
  target: null,
  label: '',
  waits: { offline: 0, login: 0, retry: 0 },
  error: null,
  bytesPerSecond: null,
  notified: null,
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

/**
 * First name of the folder an Aktion upload creates, from the API: the browser may see other
 * claims, and the form must show the folder that is really created.
 */
export const fotoPerson = $state<{ name: string | null; loading: boolean; error: string | null }>({
  name: null,
  loading: false,
  error: null,
});

export async function loadFotoPerson(): Promise<void> {
  if (fotoPerson.name || fotoPerson.loading) return;
  fotoPerson.loading = true;
  fotoPerson.error = null;
  try {
    fotoPerson.name = (await fetchApi<{ vorname: string }>('/intern/fotos/ziel')).vorname;
  } catch (error: unknown) {
    fotoPerson.error = errorMessage(
      error,
      'Dein Vorname für den Ordner konnte nicht geladen werden. Prüfe deine Internetverbindung und versuch es noch einmal.'
    );
  } finally {
    fotoPerson.loading = false;
  }
}

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

export function isActive(): boolean {
  return fotoUpload.phase === 'preparing' || fotoUpload.phase === 'running';
}
