/**
 * Local, encrypted cache of the live recording of a Mitschrift (`docs/mitschriften.md`): short
 * pieces of audio that are not transcribed yet, so a dropped connection, a crashed tab or a
 * restarted browser does not lose a part of the meeting.
 *
 * - The pieces lie in IndexedDB of this site only, never in a visible file.
 * - Each piece is encrypted with AES-GCM; the key is a non-exportable WebCrypto key that
 *   exists only in this browser profile.
 * - A piece is deleted as soon as its time range is transcribed and stored. Pieces are never
 *   played back or offered as a download; they can only be transcribed or discarded.
 * - Pieces belong to the logged-in person and expire after `MAX_AGE_DAYS`.
 */

const DB_NAME = 'mitschriften';
const DB_VERSION = 1;
const KEYS = 'keys';
const CHUNKS = 'chunks';
const KEY_ID = 'aes-gcm';
/** Pieces that were never transcribed are discarded after this many days. */
export const MAX_AGE_DAYS = 7;

export interface AudioChunkInfo {
  id: number;
  mitschriftId: number;
  title: string;
  /** Login of the recording person; other people are never offered the pieces. */
  user: string;
  source: 'raum' | 'teams';
  /** Time range in milliseconds since the start of the recording. */
  startMs: number;
  endMs: number;
  mimeType: string;
  createdAt: number;
  /** Job the piece was uploaded with; deleted once the job is done. */
  auftragId: number | null;
}

interface StoredChunk extends Omit<AudioChunkInfo, 'id'> {
  id?: number;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, { keyPath: 'id', autoIncrement: true });
        chunks.createIndex('user', 'user');
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      dbPromise = null;
      reject(open.error ?? new Error('IndexedDB unavailable'));
    };
  });
  return dbPromise;
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

let keyPromise: Promise<CryptoKey> | null = null;

/** The key of this browser profile; created once, never exportable. */
function getKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const existing = (await request((await store(KEYS, 'readonly')).get(KEY_ID))) as
      CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await request((await store(KEYS, 'readwrite')).put(key, KEY_ID));
    return key;
  })().catch((error: unknown) => {
    keyPromise = null;
    throw error;
  });
  return keyPromise;
}

/** Whether this browser can keep the encrypted cache (IndexedDB and WebCrypto). */
export function isCacheSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto?.subtle?.generateKey === 'function';
}

/** Encrypts and stores a piece of audio; returns its ID. */
export async function saveChunk(
  info: Omit<AudioChunkInfo, 'id' | 'createdAt' | 'auftragId'>,
  audio: Blob
): Promise<number> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getKey(),
    await audio.arrayBuffer()
  );
  const chunk: StoredChunk = { ...info, createdAt: Date.now(), auftragId: null, iv, data };
  return Number(await request((await store(CHUNKS, 'readwrite')).add(chunk)));
}

function toInfo(chunk: StoredChunk): AudioChunkInfo {
  return {
    id: chunk.id ?? 0,
    mitschriftId: chunk.mitschriftId,
    title: chunk.title,
    user: chunk.user,
    source: chunk.source,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    mimeType: chunk.mimeType,
    createdAt: chunk.createdAt,
    auftragId: chunk.auftragId,
  };
}

/** The pieces of a person (without audio), oldest first. */
export async function listChunks(user: string): Promise<AudioChunkInfo[]> {
  const chunks = (await request(
    (await store(CHUNKS, 'readonly')).index('user').getAll(user)
  )) as StoredChunk[];
  return chunks.map(toInfo).sort((a, b) => a.startMs - b.startMs || a.id - b.id);
}

/**
 * The decrypted audio of pieces, only to build a file for the transcription; there is no way
 * to play or save it.
 */
export async function readChunkAudio(id: number): Promise<Blob | undefined> {
  const chunk = (await request((await store(CHUNKS, 'readonly')).get(id))) as
    StoredChunk | undefined;
  if (!chunk) return undefined;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.iv },
    await getKey(),
    chunk.data
  );
  return new Blob([plain], { type: chunk.mimeType });
}

export async function deleteChunks(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const chunks = await store(CHUNKS, 'readwrite');
  await Promise.all(ids.map((id) => request(chunks.delete(id))));
}

/**
 * Notes the job pieces were uploaded with, so they are deleted once it is done; `null` offers
 * them again (the job failed).
 */
export async function markUploaded(ids: number[], auftragId: number | null): Promise<void> {
  const chunks = await store(CHUNKS, 'readwrite');
  await Promise.all(
    ids.map(async (id) => {
      const chunk = (await request(chunks.get(id))) as StoredChunk | undefined;
      if (chunk) await request(chunks.put({ ...chunk, auftragId }));
    })
  );
}

/** Discards pieces older than `MAX_AGE_DAYS` of every person; returns how many. */
export async function purgeExpired(now = Date.now()): Promise<number> {
  const chunks = await store(CHUNKS, 'readwrite');
  const all = (await request(chunks.getAll())) as StoredChunk[];
  const expired = all.filter((c) => now - c.createdAt > MAX_AGE_DAYS * 86_400_000);
  await Promise.all(expired.map((c) => request(chunks.delete(c.id ?? 0))));
  return expired.length;
}

/** Contiguous time ranges of pieces of one source, e.g. to transcribe them in one job. */
export interface ChunkRange {
  mitschriftId: number;
  title: string;
  source: 'raum' | 'teams';
  startMs: number;
  endMs: number;
  chunks: { id: number; startMs: number }[];
}

/** Pieces closer than this belong to one range. */
const RANGE_JOIN_MS = 2000;

/** Groups pieces that are not uploaded yet by Mitschrift, source and contiguous time. */
export function toRanges(chunks: AudioChunkInfo[]): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  const open = chunks
    .filter((c) => c.auftragId === null)
    .sort(
      (a, b) =>
        a.mitschriftId - b.mitschriftId || a.source.localeCompare(b.source) || a.startMs - b.startMs
    );
  for (const chunk of open) {
    const last = ranges.at(-1);
    if (
      last &&
      last.mitschriftId === chunk.mitschriftId &&
      last.source === chunk.source &&
      chunk.startMs <= last.endMs + RANGE_JOIN_MS
    ) {
      last.endMs = Math.max(last.endMs, chunk.endMs);
      last.chunks.push({ id: chunk.id, startMs: chunk.startMs });
    } else {
      ranges.push({
        mitschriftId: chunk.mitschriftId,
        title: chunk.title,
        source: chunk.source,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        chunks: [{ id: chunk.id, startMs: chunk.startMs }],
      });
    }
  }
  return ranges;
}
