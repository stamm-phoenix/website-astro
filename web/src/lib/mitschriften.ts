import { ApiError, sendApi } from './api';
import type { AudioChunkInfo, ChunkRange } from './mitschriftAudioCache';
import { deleteChunks, listChunks, markUploaded, readChunkAudio } from './mitschriftAudioCache';
import { buildWav } from './mitschriftWav';
import type { MitschriftDetail, MitschriftQuelle, UploadTicket } from './types';

export {
  AUDIO_EXTENSIONS,
  DEFAULT_SATZENDE,
  MAX_AUDIO_BYTES,
  SATZENDE_OPTIONS,
  audioContentType,
  sprecherLabel,
} from '../../../api/lib/mitschriften-model';
export type { Satzende } from '../../../api/lib/mitschriften-model';

/** `3725000` → `1:02:05`, `61000` → `01:01`. */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

/** `5400000` → „1 Std. 30 Min.“ */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'unter 1 Min.';
  if (minutes < 60) return `${minutes} Min.`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} Std. ${rest} Min.` : `${minutes / 60} Std.`;
}

export function mitschriftUrl(id: number): string {
  return `/leitendenbereich/mitschriften/mitschrift?id=${id}`;
}

/**
 * Uploads audio straight to Blob Storage with the write-only link of the job, not through the
 * API. `onProgress` receives the share uploaded (0–1).
 */
export function uploadAudio(
  ticket: UploadTicket,
  audio: Blob,
  onProgress?: (share: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('Content-Type', audio.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, 'Das Hochladen ist fehlgeschlagen.'));
    xhr.onerror = () =>
      reject(new ApiError(0, 'Das Hochladen ist fehlgeschlagen. Besteht eine Verbindung?'));
    xhr.send(audio);
  });
}

/**
 * Creates a job, uploads the audio and starts the transcription. Returns the ID of the job and
 * the Mitschrift as the API answered after the start.
 */
export async function transcribeAudio(
  mitschriftId: number,
  audio: Blob,
  range: { source: MitschriftQuelle; offsetMs: number; untilMs: number | null },
  onProgress?: (share: number) => void
): Promise<{ auftragId: number; mitschrift: MitschriftDetail }> {
  const ticket = await sendApi<UploadTicket>(
    'POST',
    `/intern/pflege/mitschriften/${mitschriftId}/auftraege`,
    { ...range, size: audio.size }
  );
  const auftragId = ticket.auftrag.id;
  try {
    await uploadAudio(ticket, audio, onProgress);
  } catch (error: unknown) {
    // The job without a file would only wait for the cleanup
    await sendApi(
      'DELETE',
      `/intern/pflege/mitschriften/${mitschriftId}/auftraege/${auftragId}`
    ).catch(() => undefined);
    throw error;
  }
  const mitschrift = await sendApi<MitschriftDetail>(
    'POST',
    `/intern/pflege/mitschriften/${mitschriftId}/auftraege/${auftragId}`
  );
  return { auftragId, mitschrift };
}

/**
 * Transcribes a range of the local cache as a gap of the live recording; its pieces stay until
 * the job is done (`settleChunks`).
 */
export async function transcribeRange(range: ChunkRange): Promise<number> {
  const pieces = (
    await Promise.all(
      range.chunks.map(async ({ id, startMs }) => ({ startMs, audio: await readChunkAudio(id) }))
    )
  ).flatMap((piece) => (piece.audio ? [{ startMs: piece.startMs, audio: piece.audio }] : []));
  const audio = await buildWav(pieces, range.startMs, range.endMs);
  const { auftragId } = await transcribeAudio(range.mitschriftId, audio, {
    source: range.source,
    offsetMs: range.startMs,
    untilMs: range.endMs,
  });
  await markUploaded(
    range.chunks.map((chunk) => chunk.id),
    auftragId
  );
  return auftragId;
}

/**
 * Deletes the local pieces whose job is done, and offers those of failed jobs again. Call it
 * whenever the Mitschrift was loaded.
 */
export async function settleChunks(detail: MitschriftDetail, user: string): Promise<void> {
  const chunks: AudioChunkInfo[] = (await listChunks(user)).filter(
    (c) => c.mitschriftId === detail.id && c.auftragId !== null
  );
  const done: number[] = [];
  const failed: number[] = [];
  for (const chunk of chunks) {
    const job = detail.auftraege.find((a) => a.id === chunk.auftragId);
    if (!job) done.push(chunk.id);
    else if (job.status === 'fehler') failed.push(chunk.id);
  }
  await deleteChunks(done);
  await markUploaded(failed, null);
}

/**
 * Words that the recognition capitalises after a cut it took for the end of a sentence; in the
 * middle of a sentence they are written in lower case. Nouns stay as they are.
 */
const LOWER_IN_SENTENCE = new Set(
  (
    'der die das dem den des ein eine einen einem einer und oder aber dass weil wenn ob als ' +
    'ich wir du er es ihr man noch auch dann denn doch also nicht nur schon so zu mit für auf ' +
    'in an bei von vom zum zur nach bis um über unter wie was wer wo sich mal halt eben'
  ).split(' ')
);

/**
 * The text of sentences joined after the recognition cut them apart: the period it put at the
 * cut goes, and a word it capitalised only because of the cut is written in lower case again.
 * Question and exclamation marks stay. Only a suggestion; the person checks it.
 */
export function joinSentences(texts: string[]): string {
  return texts
    .map((text) => text.trim())
    .filter(Boolean)
    .reduce((joined, next) => {
      if (!joined) return next;
      const cut = /[^.]\.$/.test(joined);
      const head = joined.replace(/(?<!\.)\.$/, '');
      if (!cut) return `${joined} ${next}`;
      const [word, ...rest] = next.split(' ');
      const lower = word.toLocaleLowerCase('de');
      const wordOnly = lower.replace(/[^\p{L}]/gu, '');
      return [head, LOWER_IN_SENTENCE.has(wordOnly) ? lower : word, ...rest].join(' ');
    }, '');
}

interface SmoothResponse {
  merged: number;
  nextFromMs: number | null;
  resumeFromMs: number;
  mitschrift: MitschriftDetail;
}

/**
 * Lets the API join sentences the recognition cut apart at a pause, from `fromMs` to `untilMs`
 * (`null`: to the end), one window per request. Returns where a later run starts and the
 * Mitschrift as it is afterwards.
 */
export async function smoothSentences(
  mitschriftId: number,
  fromMs: number,
  untilMs: number | null
): Promise<{ merged: number; resumeFromMs: number; mitschrift: MitschriftDetail }> {
  let next: number | null = fromMs;
  let merged = 0;
  let result: SmoothResponse | undefined;
  // A meeting of many hours needs a few dozen windows; the bound only stops a runaway loop
  for (let i = 0; next !== null; i++) {
    if (i >= 1000) {
      throw new ApiError(0, 'Nicht alle getrennten Sätze konnten geprüft werden.');
    }
    result = await sendApi<SmoothResponse>(
      'POST',
      `/intern/pflege/mitschriften/${mitschriftId}/saetze-zusammenfuegen`,
      { fromMs: next, untilMs }
    );
    merged += result.merged;
    next = result.nextFromMs;
  }
  if (!result) throw new ApiError(0, 'Die Sätze konnten nicht zusammengefügt werden.');
  return { merged, resumeFromMs: result.resumeFromMs, mitschrift: result.mitschrift };
}
