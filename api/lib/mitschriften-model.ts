/**
 * Shapes of the Mitschriften API (`docs/mitschriften.md`). Shared with the frontend
 * (`web/src/lib/types.ts`), so keep this module free of imports and Node/browser-specific APIs.
 */

/** Where a part of the transcript comes from: microphone, Teams tab or an uploaded file. */
export type MitschriftQuelle = 'raum' | 'teams' | 'datei';

export const QUELLEN: MitschriftQuelle[] = ['raum', 'teams', 'datei'];

export const QUELLE_LABELS: Record<MitschriftQuelle, string> = {
  raum: 'Raum',
  teams: 'Teams',
  datei: 'Aufnahme',
};

/** live: recording runs; datei: waiting for the uploaded file; fertig: finished. */
export type MitschriftStatus = 'live' | 'datei' | 'fertig';

/** Name shown for a speaker: the given name, else „Raum – Sprecher 2“. */
export function sprecherLabel(source: MitschriftQuelle, number: number, name: string): string {
  return name.trim() || `${QUELLE_LABELS[source]} – Sprecher ${number}`;
}

export interface MitschriftTodo {
  aufgabe: string;
  /** Who does it, as said in the meeting; `null` if nobody was named. */
  verantwortlich: string | null;
  /** Deadline as said in the meeting („bis Freitag“, „15.11.“); `null` if none was named. */
  frist: string | null;
}

/** The notes of a Mitschrift in their fixed structure. */
export interface MitschriftNotizen {
  beschluesse: string[];
  todos: MitschriftTodo[];
  offenePunkte: string[];
  /** Date, time and place of the next meeting as said; `null` if not mentioned. */
  naechsterTermin: string | null;
}

export const MAX_NOTE_ITEMS = 50;
export const MAX_NOTE_LENGTH = 500;

export function emptyNotizen(): MitschriftNotizen {
  return { beschluesse: [], todos: [], offenePunkte: [], naechsterTermin: null };
}

export interface MitschriftListItem {
  id: number;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  status: MitschriftStatus;
  /** Number of sentences. */
  abschnitte: number;
  /** End of the last sentence in milliseconds. */
  durationMs: number;
  /** Transcription jobs that are not finished yet. */
  auftraege: number;
  createdBy: string;
  updatedAt: string;
}

export interface MitschriftenOverview {
  mitschriften: MitschriftListItem[];
  /** Mitschriften older than `warnAfterMonths`; the page offers to delete them. */
  oldCount: number;
  warnAfterMonths: number;
  today: string;
}

export interface MitschriftSprecher {
  id: number;
  source: MitschriftQuelle;
  /** Run of the recognizer and speaker ID of Azure, as in `LiveAbschnitt.speakerKey`. */
  key: string;
  number: number;
  /** Given by hand; empty for the default label. */
  name: string;
  etag: string;
}

export interface MitschriftAbschnitt {
  id: number;
  sprecherId: number | null;
  source: MitschriftQuelle;
  startMs: number;
  endMs: number;
  text: string;
  etag: string;
}

/** hochladen: waiting for the upload; laeuft: at Azure Speech; fehler: failed. */
export type MitschriftAuftragStatus = 'hochladen' | 'laeuft' | 'fehler';

export interface MitschriftAuftrag {
  id: number;
  source: MitschriftQuelle;
  status: MitschriftAuftragStatus;
  /** Where the result is inserted, in milliseconds since the start of the recording. */
  offsetMs: number;
  /** End of a gap of the live recording; `null` for uploaded files. */
  untilMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface MitschriftDetail {
  id: number;
  title: string;
  date: string;
  status: MitschriftStatus;
  etag: string;
  notes: MitschriftNotizen | null;
  /** The notes were changed by hand; generating them again asks first. */
  notesEdited: boolean;
  /** The transcript changed after the notes were generated. */
  notesStale: boolean;
  notesAt: string | null;
  createdBy: string;
  createdAt: string;
  sprecher: MitschriftSprecher[];
  abschnitte: MitschriftAbschnitt[];
  auftraege: MitschriftAuftrag[];
}

/** A sentence of the live transcription, sent by the recording browser. */
export interface LiveAbschnitt {
  /** Unique per Mitschrift; sending it again changes nothing. */
  clientId: string;
  source: 'raum' | 'teams';
  /** Run of the recognizer and speaker ID of Azure, e.g. `l3:Guest-1`; `null` if unknown. */
  speakerKey: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

export interface LiveAbschnitteResult {
  /** Client IDs that are stored now (also those stored before). */
  saved: string[];
  sprecher: MitschriftSprecher[];
}

/** Short-lived token for the Speech SDK in the browser; the key stays in the API. */
export interface SpeechTokenResponse {
  token: string;
  region: string;
  locale: string;
  /** Words the recognition should expect (Stufen, terms of the Pfadfinder). */
  phrases: string[];
  /** Silence in milliseconds that ends a sentence. */
  segmentationSilenceMs: number;
  expiresInSeconds: number;
}

export interface UploadTicket {
  auftrag: MitschriftAuftrag;
  /** Write-only SAS URL of the blob, valid for a short time. */
  uploadUrl: string;
  /** Headers the PUT must send. */
  headers: Record<string, string>;
}

/** Audio formats Azure Speech batch transcription reads, by file extension. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'webm', 'flac', 'aac', 'mp4'];

export const MAX_AUDIO_BYTES = 1000 * 1024 * 1024;

/** Content type sent with an upload; unknown types are sent as generic audio. */
export function audioContentType(fileName: string, type: string): string {
  if (/^(audio|video)\/[\w.+-]+$/.test(type)) return type;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
    aac: 'audio/aac',
  };
  return types[extension] ?? 'application/octet-stream';
}
