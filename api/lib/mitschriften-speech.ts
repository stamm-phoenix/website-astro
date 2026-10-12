import { CONFIG } from './config';
import { EnvironmentVariable, getEnvironment } from './environment';

/**
 * Azure AI Speech for the Mitschriften (`docs/mitschriften.md`): short-lived tokens for the live
 * transcription in the browser and batch transcription of uploaded files and of gaps of the
 * live recording. Requests carry the key `AZURE_SPEECH_KEY`, which never leaves the API.
 * Errors carry only the HTTP status, never audio or text, so they can be logged.
 */

const API_VERSION = '2024-11-15';
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Azure deletes a finished job by itself after this time; the code deletes it as soon as its
 * result is stored. As long as `maxJobHours`, so a result waits until the page is opened again.
 */
const TIME_TO_LIVE_HOURS = Math.max(6, CONFIG.mitschriften.maxJobHours);
const MAX_SPEAKERS = 10;
/** The ID of a transcription job, the last part of its address. */
const TRANSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Minutes a token for the browser is valid (Azure issues them for ten). */
export const SPEECH_TOKEN_MINUTES = 9;

export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechError';
  }
}

function speechKey(): string {
  return getEnvironment(EnvironmentVariable.AZURE_SPEECH_KEY);
}

function transcriptionsUrl(path = ''): string {
  return `${CONFIG.mitschriften.speech.endpoint}/speechtotext/transcriptions${path}?api-version=${API_VERSION}`;
}

function transcriptionUrl(id: string, suffix = ''): string {
  if (!TRANSCRIPTION_ID.test(id)) throw new SpeechError('Invalid transcription ID');
  return transcriptionsUrl(`/${id}${suffix}`);
}

async function speechFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { 'Ocp-Apim-Subscription-Key': speechKey(), ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SpeechError('Azure Speech unreachable');
  }
}

/** A token for the Speech SDK in the browser, valid for ten minutes. */
export async function issueSpeechToken(): Promise<string> {
  const response = await speechFetch(`${CONFIG.mitschriften.speech.endpoint}/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });
  if (!response.ok) throw new SpeechError(`Speech token request failed: ${response.status}`);
  return response.text();
}

/**
 * Starts a batch transcription of one file with speaker separation. Returns the ID of the job.
 * `contentUrl` is a short-lived read link of the blob.
 */
export async function startTranscription(contentUrl: string, displayName: string): Promise<string> {
  const response = await speechFetch(transcriptionsUrl(':submit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentUrls: [contentUrl],
      locale: CONFIG.mitschriften.locale,
      displayName,
      properties: {
        diarization: { enabled: true, maxSpeakers: MAX_SPEAKERS },
        // Recordings with two channels usually carry the same mix twice
        channels: [0],
        wordLevelTimestampsEnabled: false,
        punctuationMode: 'DictatedAndAutomatic',
        profanityFilterMode: 'None',
        timeToLiveHours: TIME_TO_LIVE_HOURS,
      },
    }),
  });
  if (!response.ok) {
    throw new SpeechError(`Starting the transcription failed: ${response.status}`);
  }
  const body = (await response.json()) as { self?: unknown };
  const id = typeof body.self === 'string' ? /\/transcriptions\/([^/?]+)/.exec(body.self)?.[1] : '';
  if (!id || !TRANSCRIPTION_ID.test(id)) throw new SpeechError('Unexpected answer of Azure Speech');
  return id;
}

/** A recognized sentence of a batch transcription. */
export interface BatchPhrase {
  /** Speaker number of the speaker separation (1, 2, …); `null` if none was assigned. */
  speaker: number | null;
  offsetMs: number;
  durationMs: number;
  text: string;
}

export type TranscriptionState =
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'succeeded'; phrases: BatchPhrase[] };

/** `PT1M2.5S` → 62500 */
function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return undefined;
  const [, hours, minutes, seconds] = match;
  return Math.round(
    (Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000
  );
}

function readMs(milliseconds: unknown, duration: unknown): number {
  if (typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds >= 0) {
    return Math.round(milliseconds);
  }
  return parseDuration(duration) ?? 0;
}

/** The sentences of a transcription result file, in the order they were said. */
export function parseTranscriptionResult(result: unknown): BatchPhrase[] {
  const phrases = (result as { recognizedPhrases?: unknown })?.recognizedPhrases;
  if (!Array.isArray(phrases)) throw new SpeechError('Unexpected transcription result');
  return phrases
    .flatMap((value: unknown): BatchPhrase[] => {
      const phrase = value as Record<string, unknown>;
      if (phrase.recognitionStatus !== 'Success') return [];
      if (typeof phrase.channel === 'number' && phrase.channel !== 0) return [];
      const best = Array.isArray(phrase.nBest) ? (phrase.nBest[0] as Record<string, unknown>) : {};
      const text = typeof best?.display === 'string' ? best.display.trim() : '';
      if (!text) return [];
      const speaker = phrase.speaker;
      return [
        {
          speaker: typeof speaker === 'number' && Number.isInteger(speaker) ? speaker : null,
          offsetMs: readMs(phrase.offsetMilliseconds, phrase.offset),
          durationMs: readMs(phrase.durationMilliseconds, phrase.duration),
          text,
        },
      ];
    })
    .sort((a, b) => a.offsetMs - b.offsetMs);
}

/** The state of a job; for a finished one also its sentences. */
export async function getTranscription(id: string): Promise<TranscriptionState> {
  const response = await speechFetch(transcriptionUrl(id));
  if (response.status === 404) {
    return { status: 'failed', error: 'Der Auftrag ist bei Azure Speech nicht mehr vorhanden.' };
  }
  if (!response.ok) throw new SpeechError(`Reading the transcription failed: ${response.status}`);
  const job = (await response.json()) as {
    status?: unknown;
    properties?: { error?: { code?: unknown } };
  };
  if (job.status === 'Failed') {
    // The code (e.g. InvalidData) tells what went wrong without revealing anything of the file
    const code = job.properties?.error?.code;
    return {
      status: 'failed',
      error:
        code === 'InvalidData' || code === 'InvalidUri'
          ? 'Die Datei konnte nicht gelesen werden. Ist es eine Audiodatei?'
          : 'Die Transkription ist fehlgeschlagen.',
    };
  }
  if (job.status !== 'Succeeded') return { status: 'running' };

  const files = await speechFetch(transcriptionUrl(id, '/files'));
  if (!files.ok) throw new SpeechError(`Listing the transcription files failed: ${files.status}`);
  const list = (await files.json()) as {
    values?: { kind?: unknown; links?: { contentUrl?: unknown } }[];
  };
  const resultUrl = list.values?.find((file) => file.kind === 'Transcription')?.links?.contentUrl;
  if (typeof resultUrl !== 'string' || !resultUrl.startsWith('https://')) {
    return { status: 'succeeded', phrases: [] };
  }
  // A SAS link to the storage of Azure Speech; it must not get our key
  let result: Response;
  try {
    result = await fetch(resultUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new SpeechError('Transcription result unreachable');
  }
  if (!result.ok)
    throw new SpeechError(`Reading the transcription result failed: ${result.status}`);
  return { status: 'succeeded', phrases: parseTranscriptionResult(await result.json()) };
}

/** Deletes a job with its result at Azure Speech; a job that is gone is fine. */
export async function deleteTranscription(id: string): Promise<void> {
  const response = await speechFetch(transcriptionUrl(id), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new SpeechError(`Deleting the transcription failed: ${response.status}`);
  }
}
