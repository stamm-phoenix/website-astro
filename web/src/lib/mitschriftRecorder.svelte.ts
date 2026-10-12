import type * as SpeechSdk from 'microsoft-cognitiveservices-speech-sdk';
import { ApiError, fetchApi, sendApi } from './api';
import type { ChunkRange } from './mitschriftAudioCache';
import { deleteChunks, isCacheSupported, saveChunk } from './mitschriftAudioCache';
import { settleChunks, transcribeRange } from './mitschriften';
import type {
  LiveAbschnitteResult,
  MitschriftDetail,
  MitschriftNotizen,
  MitschriftSprecher,
  SpeechTokenResponse,
} from './types';

/**
 * Live transcription of a Mitschrift in the browser (`docs/mitschriften.md`).
 *
 * Each source (microphone in the room, sound of the Teams tab) has its own
 * ConversationTranscriber with speaker separation; the audio goes straight from the browser
 * to Azure Speech. Every finished sentence is sent to the API at once. Meanwhile each source
 * is recorded in pieces of ten seconds into the encrypted local cache; a piece is deleted as
 * soon as everything said in it is stored. If the recognition drops out, the recording goes on
 * locally, and once it is back the gap is transcribed as a batch job from the cached pieces.
 */

type Sdk = typeof SpeechSdk;
export type LiveSource = 'raum' | 'teams';

export interface LiveSentence {
  clientId: string;
  source: LiveSource;
  speakerKey: string | null;
  startMs: number;
  endMs: number;
  text: string;
  saved: boolean;
}

export type SourceState = 'startet' | 'laeuft' | 'unterbrochen' | 'pausiert' | 'beendet';

/** A time range of one source the live recognition missed. */
interface Gap {
  source: LiveSource;
  from: number;
  until: number;
  state: 'wartet' | 'laeuft' | 'fertig' | 'fehler' | 'verloren';
  auftragId: number | null;
}

interface CachedChunk {
  id: number;
  source: LiveSource;
  startMs: number;
  endMs: number;
  /** Uploaded for a gap; deleted once its job is done. */
  uploaded: boolean;
}

const CHUNK_MS = 10_000;
/** A piece is kept at least this long after its end, until the recognition has caught up. */
const SETTLE_MS = 15_000;
const TOKEN_REFRESH_MS = 8 * 60_000;
const NOTES_INTERVAL_MS = 150_000;
const JOB_POLL_MS = 20_000;
const MAX_RETRY_MS = 30_000;
/** Ticks of the Speech SDK (100 ns) per millisecond. */
const TICKS_PER_MS = 10_000;

const CHUNK_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

function chunkType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CHUNK_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Whether the browser is Firefox, which shares no tab audio. */
export function isFirefox(): boolean {
  return /Firefox\//.test(navigator.userAgent);
}

/** One source with its recognizer and its local recording. */
export class LiveSourceRecorder {
  state = $state<SourceState>('startet');
  partial = $state('');
  error = $state<string | null>(null);

  readonly audio: MediaStream;
  private transcriber: SpeechSdk.ConversationTranscriber | null = null;
  private run = 0;
  private runBase = 0;
  private lastFinalEnd = 0;
  partialStart: number | null = null;
  /** Start of the time the recognition has worked without interruption. */
  healthySince = Number.POSITIVE_INFINITY;
  private gapStart: number | null = null;
  private retryMs = 2000;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private chunkRecorder: MediaRecorder | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | undefined;
  private active = false;

  constructor(
    private readonly owner: MitschriftRecorder,
    readonly source: LiveSource,
    readonly stream: MediaStream
  ) {
    this.audio = new MediaStream(stream.getAudioTracks());
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => this.ended());
    }
  }

  /** Starts recognition and local recording. */
  start(): void {
    this.active = true;
    this.state = 'startet';
    this.startTranscriber();
    this.nextChunk();
  }

  /** Stops both; waits until the last piece is stored. */
  async stop(state: SourceState): Promise<void> {
    this.active = false;
    clearTimeout(this.retryTimer);
    // An interruption that is still open is transcribed from the local pieces
    if (this.gapStart !== null) {
      this.owner.addGap(this.source, this.gapStart, this.owner.elapsed());
      this.gapStart = null;
    }
    this.state = state;
    this.partial = '';
    this.partialStart = null;
    this.healthySince = Number.POSITIVE_INFINITY;
    await Promise.all([this.stopTranscriber(), this.stopChunks()]);
  }

  /** Releases the microphone or the shared tab. */
  release(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }

  setToken(token: string): void {
    if (this.transcriber) this.transcriber.authorizationToken = token;
  }

  private ended(): void {
    if (!this.active) return;
    this.error =
      this.source === 'teams'
        ? 'Das Teilen des Teams-Tabs wurde beendet.'
        : 'Das Mikrofon ist nicht mehr verfügbar.';
    void this.stop('beendet');
  }

  private startTranscriber(): void {
    const sdk = this.owner.sdk;
    const token = this.owner.token;
    if (!sdk || !token) return;
    const config = sdk.SpeechConfig.fromAuthorizationToken(token.token, token.region);
    config.speechRecognitionLanguage = token.locale;
    config.setProfanity(sdk.ProfanityOption.Raw);
    config.setProperty(sdk.PropertyId.SpeechServiceResponse_DiarizeIntermediateResults, 'true');
    const transcriber = new sdk.ConversationTranscriber(
      config,
      sdk.AudioConfig.fromStreamInput(this.audio)
    );
    if (token.phrases.length > 0) {
      sdk.PhraseListGrammar.fromRecognizer(transcriber).addPhrases(token.phrases);
    }
    const run = this.owner.nextRun();
    this.run = run;
    this.transcriber = transcriber;

    transcriber.transcribing = (_sender, event) => {
      if (run !== this.run) return;
      this.partial = event.result.text;
      this.partialStart ??= this.runBase + event.result.offset / TICKS_PER_MS;
    };
    transcriber.transcribed = (_sender, event) => {
      if (run !== this.run) return;
      this.partial = '';
      this.partialStart = null;
      const text = event.result.text?.trim();
      if (event.result.reason !== sdk.ResultReason.RecognizedSpeech || !text) return;
      const startMs = Math.round(this.runBase + event.result.offset / TICKS_PER_MS);
      const endMs = Math.round(startMs + event.result.duration / TICKS_PER_MS);
      const speaker = event.result.speakerId;
      this.lastFinalEnd = Math.max(this.lastFinalEnd, endMs);
      this.owner.addSentence({
        clientId: crypto.randomUUID(),
        source: this.source,
        speakerKey: speaker && speaker !== 'Unknown' ? `l${run}:${speaker}` : null,
        startMs,
        endMs,
        text,
        saved: false,
      });
    };
    transcriber.canceled = (_sender, event) => {
      if (run !== this.run || event.reason !== sdk.CancellationReason.Error) return;
      this.fail();
    };
    transcriber.sessionStopped = () => {
      if (run === this.run && this.active) this.fail();
    };

    this.runBase = this.owner.elapsed();
    transcriber.startTranscribingAsync(
      () => {
        if (run !== this.run) return;
        this.state = 'laeuft';
        this.error = null;
        this.retryMs = 2000;
        this.healthySince = this.runBase;
        if (this.gapStart !== null) {
          this.owner.addGap(this.source, this.gapStart, this.runBase);
          this.gapStart = null;
        }
      },
      () => {
        if (run === this.run) this.fail();
      }
    );
  }

  private async stopTranscriber(): Promise<void> {
    const transcriber = this.transcriber;
    this.transcriber = null;
    this.run = -1;
    if (!transcriber) return;
    await new Promise<void>((resolve) =>
      transcriber.stopTranscribingAsync(
        () => resolve(),
        () => resolve()
      )
    );
    transcriber.close();
  }

  /** The recognition dropped out: everything since the last finished sentence may be lost. */
  private fail(): void {
    if (!this.active || this.state === 'unterbrochen') return;
    const now = this.owner.elapsed();
    this.gapStart ??=
      this.partialStart ?? Math.max(this.lastFinalEnd, this.runBase, now - SETTLE_MS);
    this.state = 'unterbrochen';
    this.partial = '';
    this.partialStart = null;
    this.healthySince = Number.POSITIVE_INFINITY;
    void this.stopTranscriber();
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.restart(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private async restart(): Promise<void> {
    if (!this.active) return;
    try {
      await this.owner.refreshToken();
    } catch {
      // Offline: try again later
      this.retryTimer = setTimeout(() => void this.restart(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      return;
    }
    this.startTranscriber();
  }

  /** Records the next piece; each piece is a file of its own, so it can be decoded alone. */
  private nextChunk(): void {
    const type = this.owner.chunkType;
    if (!this.active || !type) return;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.audio, { mimeType: type, audioBitsPerSecond: 32_000 });
    } catch {
      return;
    }
    const startMs = this.owner.elapsed();
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        if (parts.length > 0) {
          void this.owner.storeChunk(
            this.source,
            startMs,
            this.owner.elapsed(),
            new Blob(parts, { type })
          );
        }
        resolve();
      };
    });
    this.chunkRecorder = recorder;
    this.chunkStopped = stopped;
    recorder.start();
    this.chunkTimer = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
      this.nextChunk();
    }, CHUNK_MS);
  }

  private chunkStopped: Promise<void> = Promise.resolve();

  private async stopChunks(): Promise<void> {
    clearTimeout(this.chunkTimer);
    const recorder = this.chunkRecorder;
    this.chunkRecorder = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    await this.chunkStopped;
  }
}

export interface RecorderOptions {
  mitschrift: MitschriftDetail;
  /** Login of the recording person, owner of the local pieces. */
  user: string;
  onDetail: (detail: MitschriftDetail) => void;
}

/** The live recording of one Mitschrift on this computer. */
export class MitschriftRecorder {
  status = $state<'bereit' | 'aufnahme' | 'pausiert' | 'beendet'>('bereit');
  sources = $state<LiveSourceRecorder[]>([]);
  sentences = $state<LiveSentence[]>([]);
  sprecher = $state.raw<MitschriftSprecher[]>([]);
  /** Running notes, shown only on this computer. */
  notes = $state.raw<MitschriftNotizen | null>(null);
  notesError = $state<string | null>(null);
  /** Sentences could not be sent to the API (they are sent again). */
  saveFailing = $state(false);
  gaps = $state<Gap[]>([]);
  /** The local cache works; without it gaps cannot be transcribed again. */
  readonly cacheSupported = isCacheSupported();
  wakeLockActive = $state(false);

  sdk: Sdk | null = null;
  token: SpeechTokenResponse | null = null;
  readonly chunkType = chunkType();

  private readonly mitschriftId: number;
  private readonly title: string;
  private readonly user: string;
  private readonly onDetail: (detail: MitschriftDetail) => void;
  private runs = 0;
  /** Recording time at the start, so the times continue an existing transcript. */
  private offsetMs: number;
  private startedAt = 0;
  private chunks: CachedChunk[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private tokenTimer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | null = null;
  private saveRetryMs = 2000;
  private nextSaveAt = 0;
  private notesAt = 0;
  private notesBasis = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private readonly visibility = (): void => {
    if (document.visibilityState === 'visible' && this.status === 'aufnahme') void this.lock();
  };

  constructor(options: RecorderOptions) {
    this.mitschriftId = options.mitschrift.id;
    this.title = options.mitschrift.title;
    this.user = options.user;
    this.onDetail = options.onDetail;
    this.sprecher = options.mitschrift.sprecher;
    const last = options.mitschrift.abschnitte.reduce((max, a) => Math.max(max, a.endMs), 0);
    this.offsetMs = last > 0 ? last + 2000 : 0;
  }

  /** Milliseconds since the start of the recording, continuing an existing transcript. */
  elapsed(): number {
    return Math.round(this.offsetMs + (performance.now() - this.startedAt));
  }

  nextRun(): number {
    return ++this.runs;
  }

  async refreshToken(): Promise<void> {
    this.token = await fetchApi<SpeechTokenResponse>('/intern/mitschriften-token');
    for (const source of this.sources) source.setToken(this.token.token);
  }

  /** Loads the Speech SDK and a token; call before adding sources. */
  async prepare(): Promise<void> {
    const [sdk] = await Promise.all([
      import('microsoft-cognitiveservices-speech-sdk'),
      this.refreshToken(),
    ]);
    this.sdk = sdk;
  }

  /** Asks for the microphone (the conference speaker in the middle of the table). */
  async addMicrophone(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.addSource('raum', stream);
  }

  /**
   * Asks for the sound of the Teams tab („Tab-Audio teilen“). Throws if the browser shares no
   * sound, like Firefox.
   */
  async addTeamsTab(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Hints for Chrome: a tab, not the own one
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
    } as DisplayMediaStreamOptions);
    // Only the sound is needed
    for (const track of stream.getVideoTracks()) track.stop();
    if (stream.getAudioTracks().length === 0) {
      throw new Error(
        'Der Browser hat keinen Ton geteilt. Bitte den Teams-Tab wählen und „Tab-Audio teilen“ einschalten (Chrome, Edge oder Chromium).'
      );
    }
    this.addSource('teams', stream);
  }

  private addSource(source: LiveSource, stream: MediaStream): void {
    const existing = this.sources.find((s) => s.source === source);
    if (existing) {
      void existing.stop('beendet');
      existing.release();
    }
    const recorder = new LiveSourceRecorder(this, source, stream);
    this.sources = [...this.sources.filter((s) => s.source !== source), recorder];
    if (this.status === 'aufnahme') recorder.start();
    else recorder.state = 'pausiert';
  }

  /** Starts (or continues) the recording of all sources. */
  start(): void {
    if (this.status === 'bereit') {
      this.startedAt = performance.now();
      this.timers.push(setInterval(() => void this.tick(), 5000));
      this.tokenTimer = setInterval(
        () => void this.refreshToken().catch(() => undefined),
        TOKEN_REFRESH_MS
      );
      document.addEventListener('visibilitychange', this.visibility);
      this.notesAt = Date.now();
    }
    this.status = 'aufnahme';
    for (const source of this.sources) if (source.state !== 'beendet') source.start();
    void this.lock();
  }

  /** Pauses: no audio goes to Azure and nothing into the local cache. */
  async pause(): Promise<void> {
    this.status = 'pausiert';
    await Promise.all(this.sources.map((s) => (s.state === 'beendet' ? null : s.stop('pausiert'))));
    await this.unlock();
  }

  /**
   * Ends the recording: stops all sources, sends the remaining sentences and transcribes gaps
   * from the local cache. Throws if sentences could not be sent; calling it again retries.
   */
  async finish(): Promise<void> {
    if (this.status !== 'beendet') {
      await Promise.all(this.sources.map((s) => s.stop('beendet')));
      for (const source of this.sources) source.release();
      this.status = 'beendet';
      await this.unlock();
      document.removeEventListener('visibilitychange', this.visibility);
      clearInterval(this.tokenTimer);
    }
    this.nextSaveAt = 0;
    await this.flush();
    if (this.sentences.some((s) => !s.saved)) {
      throw new ApiError(0, 'Nicht alle Sätze konnten gespeichert werden. Bitte erneut versuchen.');
    }
    await this.processGaps(true);
    await this.cleanupChunks(true);
  }

  /** Stops timers; the recording must be finished or abandoned. */
  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    clearInterval(this.tokenTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    for (const source of this.sources) {
      void source.stop('beendet');
      source.release();
    }
    void this.unlock();
  }

  addSentence(sentence: LiveSentence): void {
    this.sentences.push(sentence);
    void this.flush();
  }

  addGap(source: LiveSource, from: number, until: number): void {
    if (until - from < 500) return;
    this.gaps.push({ source, from, until, state: 'wartet', auftragId: null });
  }

  async storeChunk(source: LiveSource, startMs: number, endMs: number, audio: Blob): Promise<void> {
    if (!this.cacheSupported) return;
    try {
      const id = await saveChunk(
        {
          mitschriftId: this.mitschriftId,
          title: this.title,
          user: this.user,
          source,
          startMs,
          endMs,
          mimeType: audio.type,
        },
        audio
      );
      this.chunks.push({ id, source, startMs, endMs, uploaded: false });
    } catch {
      // Storage full or blocked: the live transcription goes on without a safety net
    }
  }

  /** Sends unsaved sentences; failures are retried with growing pauses. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (Date.now() < this.nextSaveAt) return Promise.resolve();
    const batch = this.sentences.filter((s) => !s.saved).slice(0, 50);
    if (batch.length === 0) return Promise.resolve();
    this.flushing = (async () => {
      try {
        const result = await sendApi<LiveAbschnitteResult>(
          'POST',
          `/intern/pflege/mitschriften/${this.mitschriftId}/abschnitte`,
          {
            abschnitte: batch.map((s) => ({
              clientId: s.clientId,
              source: s.source,
              speakerKey: s.speakerKey,
              startMs: s.startMs,
              endMs: s.endMs,
              text: s.text,
            })),
          }
        );
        for (const sentence of this.sentences) {
          if (result.saved.includes(sentence.clientId)) sentence.saved = true;
        }
        this.sprecher = result.sprecher;
        this.saveFailing = false;
        this.saveRetryMs = 2000;
      } catch {
        this.saveFailing = true;
        this.nextSaveAt = Date.now() + this.saveRetryMs;
        this.saveRetryMs = Math.min(this.saveRetryMs * 2, MAX_RETRY_MS);
      } finally {
        this.flushing = null;
      }
      if (!this.saveFailing && this.sentences.some((s) => !s.saved)) await this.flush();
    })();
    return this.flushing;
  }

  private async tick(): Promise<void> {
    await this.flush();
    await this.cleanupChunks(false);
    await this.processGaps(false);
    await this.pollJobs();
    if (this.status === 'aufnahme') await this.updateNotes();
  }

  /** Whether a piece lies in a gap that is not transcribed yet. */
  private inGap(chunk: CachedChunk): boolean {
    return this.gaps.some(
      (gap) =>
        gap.source === chunk.source &&
        gap.state !== 'fertig' &&
        gap.state !== 'verloren' &&
        chunk.endMs > gap.from &&
        chunk.startMs < gap.until
    );
  }

  /**
   * Deletes pieces whose time range is completely transcribed and stored: the recognition ran
   * the whole time, it has nothing open from before the end of the piece, and every sentence
   * that starts in it is saved.
   */
  private async cleanupChunks(final: boolean): Promise<void> {
    const now = this.elapsed();
    const deletable = this.chunks.filter((chunk) => {
      if (chunk.uploaded || this.inGap(chunk)) return false;
      const source = this.sources.find((s) => s.source === chunk.source);
      const open = source?.partialStart ?? null;
      const settled =
        final || (now - chunk.endMs > SETTLE_MS && (open === null || open >= chunk.endMs));
      const covered =
        final ||
        source?.state === 'pausiert' ||
        source?.state === 'beendet' ||
        (source !== undefined && chunk.startMs >= source.healthySince);
      const saved = !this.sentences.some(
        (s) => !s.saved && s.source === chunk.source && s.startMs < chunk.endMs
      );
      return settled && covered && saved;
    });
    if (deletable.length === 0) return;
    try {
      await deleteChunks(deletable.map((c) => c.id));
      this.chunks = this.chunks.filter((c) => !deletable.includes(c));
    } catch {
      // Tried again on the next tick
    }
  }

  /** Transcribes gaps whose pieces are complete, as batch jobs. */
  private async processGaps(final: boolean): Promise<void> {
    const now = this.elapsed();
    for (const gap of this.gaps) {
      if (gap.state !== 'wartet' || (!final && now < gap.until + CHUNK_MS + 2000)) continue;
      const pieces = this.chunks.filter(
        (c) => c.source === gap.source && c.endMs > gap.from && c.startMs < gap.until
      );
      if (pieces.length === 0) {
        gap.state = 'verloren';
        continue;
      }
      const range: ChunkRange = {
        mitschriftId: this.mitschriftId,
        title: this.title,
        source: gap.source,
        startMs: Math.min(...pieces.map((p) => p.startMs)),
        endMs: Math.max(...pieces.map((p) => p.endMs)),
        chunks: pieces.map((p) => ({ id: p.id, startMs: p.startMs })),
      };
      try {
        gap.auftragId = await transcribeRange(range);
        gap.state = 'laeuft';
        for (const piece of pieces) piece.uploaded = true;
      } catch {
        // Offline: tried again on the next tick
      }
    }
  }

  /** Asks about running gap jobs; done ones remove their local pieces. */
  private lastPoll = 0;
  private async pollJobs(): Promise<void> {
    if (!this.gaps.some((g) => g.state === 'laeuft') || Date.now() - this.lastPoll < JOB_POLL_MS) {
      return;
    }
    this.lastPoll = Date.now();
    try {
      const { mitschrift } = await sendApi<{ stored: boolean; mitschrift: MitschriftDetail }>(
        'POST',
        `/intern/pflege/mitschriften/${this.mitschriftId}/pruefen`
      );
      // Deletes the pieces of jobs that are done (in the cache)
      await settleChunks(mitschrift, this.user);
      for (const gap of this.gaps) {
        if (gap.state !== 'laeuft') continue;
        const job = mitschrift.auftraege.find((a) => a.id === gap.auftragId);
        if (!job) gap.state = 'fertig';
        else if (job.status === 'fehler') gap.state = 'fehler';
      }
      this.chunks = this.chunks.filter((chunk) => !chunk.uploaded || this.inGap(chunk));
      this.onDetail(mitschrift);
    } catch {
      // Tried again later
    }
  }

  /** Running notes every few minutes, from what was said so far. */
  private async updateNotes(force = false): Promise<void> {
    const count = this.sentences.filter((s) => s.saved).length;
    if (!force && (Date.now() - this.notesAt < NOTES_INTERVAL_MS || count === this.notesBasis)) {
      return;
    }
    this.notesAt = Date.now();
    this.notesBasis = count;
    try {
      const result = await sendApi<{ notes: MitschriftNotizen }>(
        'POST',
        `/intern/pflege/mitschriften/${this.mitschriftId}/notizen`,
        { pass: 'laufend', save: false }
      );
      this.notes = result.notes;
      this.notesError = null;
    } catch (error: unknown) {
      this.notesError =
        error instanceof ApiError ? error.message : 'Die Notizen konnten nicht erzeugt werden.';
    }
  }

  refreshNotes(): Promise<void> {
    return this.updateNotes(true);
  }

  private async lock(): Promise<void> {
    if (this.wakeLock || !('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLockActive = true;
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        this.wakeLockActive = false;
      });
    } catch {
      this.wakeLockActive = false;
    }
  }

  private async unlock(): Promise<void> {
    const lock = this.wakeLock;
    this.wakeLock = null;
    this.wakeLockActive = false;
    await lock?.release().catch(() => undefined);
  }

  /** Gaps that are still being transcribed, or could not be. */
  openGaps(): Gap[] {
    return this.gaps.filter((g) => g.state !== 'fertig');
  }
}
