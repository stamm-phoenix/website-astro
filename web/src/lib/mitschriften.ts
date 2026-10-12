import { ApiError, sendApi } from './api';
import type { AudioChunkInfo, ChunkRange } from './mitschriftAudioCache';
import { deleteChunks, listChunks, markUploaded, readChunkAudio } from './mitschriftAudioCache';
import { buildWav } from './mitschriftWav';
import type { MitschriftDetail, MitschriftQuelle, UploadTicket } from './types';

export {
  AUDIO_EXTENSIONS,
  MAX_AUDIO_BYTES,
  audioContentType,
  sprecherLabel,
} from '../../../api/lib/mitschriften-model';

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
