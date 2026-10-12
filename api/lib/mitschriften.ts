/**
 * Mitschriften (#266, `docs/mitschriften.md`): transcripts of meetings with AI notes, stored in
 * Azure SQL (`mitschrift.*`, migration `0005_mitschriften.sql`). Audio is never stored here: the
 * live recording streams from the browser to Azure Speech, uploaded files lie in Blob Storage
 * only while their transcription job runs (`mitschrift.auftrag`) and are deleted for good
 * right after. Changes overwrite the old text, deleted sentences are deleted for good.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import { createReadUrl, createUploadUrl, deleteBlobPermanently, getBlobSize } from './blob-storage';
import { CONFIG } from './config';
import type { Db } from './db';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  inTransaction,
  lockResource,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { AuftragStatus, Database } from './db-schema';
import { PREVIEW_DATABASE } from './deployment';
import type {
  LiveAbschnitt,
  MitschriftAbschnitt,
  MitschriftAuftrag,
  MitschriftDetail,
  MitschriftListItem,
  MitschriftNotizen,
  MitschriftQuelle,
  MitschriftSprecher,
  MitschriftStatus,
  MitschriftenOverview,
  UploadTicket,
} from './mitschriften-model';
import { parseStoredNotizen } from './mitschriften-notizen';
import type { BatchPhrase } from './mitschriften-speech';
import { deleteTranscription, getTranscription, startTranscription } from './mitschriften-speech';
import { dateToLocalParts } from './nikolaus-config';
import { ValidationError } from './pflege-validation';

/** Minutes the browser has to upload a file with its upload link. */
const UPLOAD_MINUTES = 120;
/** Rows per INSERT; SQL Server allows 2100 parameters per statement. */
const INSERT_CHUNK = 200;

type Trx = Transaction<Database>;

// --- Dates ---

/** The first meeting date that is not old yet; older Mitschriften are pointed out. */
export function warnBefore(now: Date = new Date()): string {
  const [year, month, day] = dateToLocalParts(now).date.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - CONFIG.mitschriften.warnAfterMonths, day));
  return start.toISOString().slice(0, 10);
}

// --- Reading ---

export async function getMitschriftenOverview(
  now: Date = new Date()
): Promise<MitschriftenOverview> {
  const rows = await getDb()
    .selectFrom('mitschrift.mitschrift as m')
    .select((eb) => [
      'm.id',
      'm.title',
      'm.meeting_date',
      'm.status',
      'm.created_by',
      'm.updated_at',
      eb
        .selectFrom('mitschrift.abschnitt as a')
        .select(sql<number>`COUNT(*)`.as('n'))
        .whereRef('a.mitschrift_id', '=', 'm.id')
        .as('abschnitte'),
      eb
        .selectFrom('mitschrift.abschnitt as a')
        .select(sql<number | null>`MAX(a.end_ms)`.as('n'))
        .whereRef('a.mitschrift_id', '=', 'm.id')
        .as('duration'),
      eb
        .selectFrom('mitschrift.auftrag as j')
        .select(sql<number>`COUNT(*)`.as('n'))
        .whereRef('j.mitschrift_id', '=', 'm.id')
        .where('j.status', 'in', ['hochladen', 'laeuft'])
        .as('auftraege'),
    ])
    .orderBy('m.meeting_date', 'desc')
    .orderBy('m.id', 'desc')
    .execute();
  const before = warnBefore(now);
  const mitschriften: MitschriftListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    date: toDateString(row.meeting_date),
    status: row.status,
    abschnitte: Number(row.abschnitte ?? 0),
    durationMs: Number(row.duration ?? 0),
    auftraege: Number(row.auftraege ?? 0),
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
  }));
  return {
    mitschriften,
    oldCount: mitschriften.filter((m) => m.date < before).length,
    warnAfterMonths: CONFIG.mitschriften.warnAfterMonths,
    today: dateToLocalParts(now).date,
  };
}

function toSprecher(row: {
  id: number;
  version: Buffer;
  source: MitschriftQuelle;
  key: string;
  number: number;
  name: string;
}): MitschriftSprecher {
  return {
    id: row.id,
    source: row.source,
    key: row.key,
    number: row.number,
    name: row.name,
    etag: toVersion(row.version),
  };
}

async function getSprecher(db: Db, mitschriftId: number): Promise<MitschriftSprecher[]> {
  const rows = await db
    .selectFrom('mitschrift.sprecher')
    .select(['id', 'version', 'source', 'key', 'number', 'name'])
    .where('mitschrift_id', '=', mitschriftId)
    .orderBy('source')
    .orderBy('number')
    .execute();
  return rows.map(toSprecher);
}

function toAuftrag(row: {
  id: number;
  source: MitschriftQuelle;
  status: AuftragStatus;
  offset_ms: number;
  until_ms: number | null;
  error: string | null;
  created_at: Date;
}): MitschriftAuftrag {
  return {
    id: row.id,
    source: row.source,
    // A finished job only waits for its blob to be deleted
    status: row.status === 'erledigt' ? 'laeuft' : row.status,
    offsetMs: row.offset_ms,
    untilMs: row.until_ms,
    error: row.error,
    createdAt: row.created_at.toISOString(),
  };
}

const AUFTRAG_COLUMNS = [
  'id',
  'mitschrift_id',
  'source',
  'blob_name',
  'status',
  'transcription',
  'offset_ms',
  'until_ms',
  'error',
  'created_at',
] as const;

export async function getMitschrift(id: number): Promise<MitschriftDetail | undefined> {
  const db = getDb();
  const meeting = await db
    .selectFrom('mitschrift.mitschrift')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!meeting) return undefined;
  const [sprecher, abschnitte, auftraege] = await Promise.all([
    getSprecher(db, id),
    db
      .selectFrom('mitschrift.abschnitt')
      .select(['id', 'version', 'sprecher_id', 'source', 'start_ms', 'end_ms', 'text'])
      .where('mitschrift_id', '=', id)
      .orderBy('start_ms')
      .orderBy('id')
      .execute(),
    db
      .selectFrom('mitschrift.auftrag')
      .select(AUFTRAG_COLUMNS)
      .where('mitschrift_id', '=', id)
      .orderBy('id')
      .execute(),
  ]);
  return {
    id: meeting.id,
    title: meeting.title,
    date: toDateString(meeting.meeting_date),
    status: meeting.status,
    etag: toVersion(meeting.version),
    notes: parseStoredNotizen(meeting.notes),
    notesEdited: meeting.notes_edited,
    notesStale: meeting.notes_stale,
    notesAt: meeting.notes_at?.toISOString() ?? null,
    createdBy: meeting.created_by,
    createdAt: meeting.created_at.toISOString(),
    sprecher,
    abschnitte: abschnitte.map((row): MitschriftAbschnitt => ({
      id: row.id,
      sprecherId: row.sprecher_id,
      source: row.source,
      startMs: row.start_ms,
      endMs: row.end_ms,
      text: row.text,
      etag: toVersion(row.version),
    })),
    auftraege: auftraege.map(toAuftrag),
  };
}

/** Like `getMitschrift`, but a missing Mitschrift is an error (404). */
export async function requireMitschrift(id: number): Promise<MitschriftDetail> {
  const detail = await getMitschrift(id);
  if (!detail) throw new RecordNotFoundError();
  return detail;
}

// --- Mitschrift ---

export interface MitschriftInput {
  title: string;
  date: string;
}

export async function createMitschrift(
  input: MitschriftInput & { status: Exclude<MitschriftStatus, 'fertig'> },
  actor: string
): Promise<number> {
  const { id } = await getDb()
    .insertInto('mitschrift.mitschrift')
    .values({
      title: input.title,
      meeting_date: input.date,
      status: input.status,
      notes: null,
      notes_at: null,
      created_by: actor,
      updated_by: actor,
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return id;
}

function touch(actor: string) {
  return { updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` };
}

/** Changes title and date against the loaded version; returns the new version. */
export async function updateMitschrift(
  id: number,
  input: MitschriftInput,
  etag: string,
  actor: string
): Promise<string> {
  const updated = await getDb()
    .updateTable('mitschrift.mitschrift')
    .set({ title: input.title, meeting_date: input.date, ...touch(actor) })
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .output('inserted.version')
    .executeTakeFirst();
  if (!updated) throw new VersionConflictError();
  return toVersion(updated.version);
}

/** Ends the live recording; a Mitschrift that is finished already stays so. */
export async function finishMitschrift(id: number, actor: string): Promise<void> {
  const result = await getDb()
    .updateTable('mitschrift.mitschrift')
    .set({ status: 'fertig', ...touch(actor) })
    .where('id', '=', id)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw new RecordNotFoundError();
}

/**
 * Deletes a Mitschrift for good with its transcript and notes; blobs and jobs of its open
 * transcriptions are deleted first. Returns false if it did not exist.
 */
export async function deleteMitschrift(id: number): Promise<boolean> {
  const jobs = await getDb()
    .selectFrom('mitschrift.auftrag')
    .select(AUFTRAG_COLUMNS)
    .where('mitschrift_id', '=', id)
    .execute();
  for (const job of jobs) await removeAzureData(job);
  const result = await getDb()
    .deleteFrom('mitschrift.mitschrift')
    .where('id', '=', id)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/** Deletes all Mitschriften of meetings before `warnBefore`; returns how many. */
export async function deleteOldMitschriften(now: Date = new Date()): Promise<number> {
  const old = await getDb()
    .selectFrom('mitschrift.mitschrift')
    .select('id')
    .where('meeting_date', '<', warnBefore(now))
    .execute();
  let deleted = 0;
  for (const { id } of old) if (await deleteMitschrift(id)) deleted++;
  return deleted;
}

async function lockMitschrift(trx: Trx, id: number) {
  await lockResource(trx, `mitschrift:${id}`);
  const meeting = await trx
    .selectFrom('mitschrift.mitschrift')
    .select(['id', 'status', 'notes'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!meeting) throw new RecordNotFoundError();
  return meeting;
}

/** Marks the notes as outdated after the transcript changed (if there are notes). */
async function markNotesStale(trx: Trx, id: number, actor: string): Promise<void> {
  await trx
    .updateTable('mitschrift.mitschrift')
    .set({ notes_stale: sql<boolean>`CASE WHEN notes IS NULL THEN 0 ELSE 1 END`, ...touch(actor) })
    .where('id', '=', id)
    .execute();
}

// --- Speakers ---

/**
 * The IDs of the speakers with these keys, created with the next numbers of their source in
 * the given order where missing.
 */
async function ensureSprecher(
  trx: Trx,
  mitschriftId: number,
  keys: { source: MitschriftQuelle; key: string }[]
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (keys.length === 0) return ids;
  const existing = await trx
    .selectFrom('mitschrift.sprecher')
    .select(['id', 'source', 'key', 'number'])
    .where('mitschrift_id', '=', mitschriftId)
    .execute();
  const next = new Map<MitschriftQuelle, number>();
  for (const row of existing) {
    ids.set(`${row.source}|${row.key}`, row.id);
    next.set(row.source, Math.max(next.get(row.source) ?? 0, row.number));
  }
  for (const { source, key } of keys) {
    const id = `${source}|${key}`;
    if (ids.has(id)) continue;
    const number = (next.get(source) ?? 0) + 1;
    next.set(source, number);
    const row = await trx
      .insertInto('mitschrift.sprecher')
      .values({ mitschrift_id: mitschriftId, source, key, number })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    ids.set(id, row.id);
  }
  return ids;
}

/** Gives a speaker a name (empty: the default label). Returns the new version. */
export async function renameSprecher(
  mitschriftId: number,
  sprecherId: number,
  name: string,
  etag: string,
  actor: string
): Promise<string> {
  return inTransaction(async (trx) => {
    await lockMitschrift(trx, mitschriftId);
    const updated = await trx
      .updateTable('mitschrift.sprecher')
      .set({ name })
      .where('id', '=', sprecherId)
      .where('mitschrift_id', '=', mitschriftId)
      .where('version', '=', requireVersion(etag))
      .output('inserted.version')
      .executeTakeFirst();
    if (!updated) throw new VersionConflictError();
    await markNotesStale(trx, mitschriftId, actor);
    return toVersion(updated.version);
  });
}

/** Assigns all sentences of one speaker to another and removes the first. */
export async function mergeSprecher(
  mitschriftId: number,
  fromId: number,
  intoId: number,
  actor: string
): Promise<void> {
  if (fromId === intoId)
    throw new ValidationError({ into: 'Bitte einen anderen Sprecher wählen.' });
  await inTransaction(async (trx) => {
    await lockMitschrift(trx, mitschriftId);
    const found = await trx
      .selectFrom('mitschrift.sprecher')
      .select('id')
      .where('mitschrift_id', '=', mitschriftId)
      .where('id', 'in', [fromId, intoId])
      .execute();
    if (found.length !== 2) throw new RecordNotFoundError();
    await trx
      .updateTable('mitschrift.abschnitt')
      .set({ sprecher_id: intoId })
      .where('mitschrift_id', '=', mitschriftId)
      .where('sprecher_id', '=', fromId)
      .execute();
    await trx.deleteFrom('mitschrift.sprecher').where('id', '=', fromId).execute();
    await markNotesStale(trx, mitschriftId, actor);
  });
}

// --- Sentences ---

interface NewAbschnitt {
  sprecher_id: number | null;
  source: MitschriftQuelle;
  start_ms: number;
  end_ms: number;
  text: string;
  client_id: string | null;
}

async function insertAbschnitte(trx: Trx, mitschriftId: number, rows: NewAbschnitt[]) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await trx
      .insertInto('mitschrift.abschnitt')
      .values(
        rows.slice(i, i + INSERT_CHUNK).map((row) => ({ ...row, mitschrift_id: mitschriftId }))
      )
      .execute();
  }
}

/**
 * Stores finished sentences of the live recording. Sentences sent before are skipped, so the
 * browser can repeat a request after an error. Returns the stored client IDs and the speakers.
 */
export async function appendLiveAbschnitte(
  mitschriftId: number,
  abschnitte: LiveAbschnitt[],
  actor: string
): Promise<{ saved: string[]; sprecher: MitschriftSprecher[] }> {
  return inTransaction(async (trx) => {
    const meeting = await lockMitschrift(trx, mitschriftId);
    if (meeting.status !== 'live') {
      throw new ValidationError({ status: 'Die Aufnahme dieser Mitschrift ist beendet.' });
    }
    const clientIds = abschnitte.map((a) => a.clientId);
    const known = new Set(
      clientIds.length === 0
        ? []
        : (
            await trx
              .selectFrom('mitschrift.abschnitt')
              .select('client_id')
              .where('mitschrift_id', '=', mitschriftId)
              .where('client_id', 'in', clientIds)
              .execute()
          ).map((row) => row.client_id)
    );
    const fresh = abschnitte.filter((a) => !known.has(a.clientId));
    const speakers = await ensureSprecher(
      trx,
      mitschriftId,
      fresh.flatMap((a) => (a.speakerKey ? [{ source: a.source, key: a.speakerKey }] : []))
    );
    await insertAbschnitte(
      trx,
      mitschriftId,
      fresh.map((a) => ({
        sprecher_id: a.speakerKey ? (speakers.get(`${a.source}|${a.speakerKey}`) ?? null) : null,
        source: a.source,
        start_ms: a.startMs,
        end_ms: a.endMs,
        text: a.text,
        client_id: a.clientId,
      }))
    );
    if (fresh.length > 0) await markNotesStale(trx, mitschriftId, actor);
    return { saved: clientIds, sprecher: await getSprecher(trx, mitschriftId) };
  });
}

/** Changes the text and speaker of a sentence against its loaded version. */
export async function updateAbschnitt(
  mitschriftId: number,
  abschnittId: number,
  input: { text: string; sprecherId: number | null },
  etag: string,
  actor: string
): Promise<string> {
  return inTransaction(async (trx) => {
    await lockMitschrift(trx, mitschriftId);
    if (input.sprecherId !== null) {
      const speaker = await trx
        .selectFrom('mitschrift.sprecher')
        .select('id')
        .where('id', '=', input.sprecherId)
        .where('mitschrift_id', '=', mitschriftId)
        .executeTakeFirst();
      if (!speaker) throw new ValidationError({ sprecherId: 'Diesen Sprecher gibt es nicht.' });
    }
    const updated = await trx
      .updateTable('mitschrift.abschnitt')
      .set({ text: input.text, sprecher_id: input.sprecherId })
      .where('id', '=', abschnittId)
      .where('mitschrift_id', '=', mitschriftId)
      .where('version', '=', requireVersion(etag))
      .output('inserted.version')
      .executeTakeFirst();
    if (!updated) throw new VersionConflictError();
    await markNotesStale(trx, mitschriftId, actor);
    return toVersion(updated.version);
  });
}

/**
 * Deletes sentences for good. The notes are removed in the same transaction, so nothing of the
 * deleted sentences survives in a summary; the caller generates them again. Returns how many
 * sentences were deleted.
 */
export async function deleteAbschnitte(
  mitschriftId: number,
  ids: number[],
  actor: string
): Promise<number> {
  return inTransaction(async (trx) => {
    await lockMitschrift(trx, mitschriftId);
    let deleted = 0;
    for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
      const result = await trx
        .deleteFrom('mitschrift.abschnitt')
        .where('mitschrift_id', '=', mitschriftId)
        .where('id', 'in', ids.slice(i, i + INSERT_CHUNK))
        .executeTakeFirst();
      deleted += Number(result.numDeletedRows);
    }
    if (deleted > 0) {
      await trx
        .updateTable('mitschrift.mitschrift')
        .set({
          notes: null,
          notes_edited: false,
          notes_stale: false,
          notes_at: null,
          ...touch(actor),
        })
        .where('id', '=', mitschriftId)
        .execute();
    }
    return deleted;
  });
}

// --- Notes ---

/**
 * Stores notes against the loaded version: written by the model (`edited` false) or changed
 * by hand. Returns the new version.
 */
export async function saveNotizen(
  mitschriftId: number,
  notes: MitschriftNotizen,
  etag: string,
  edited: boolean,
  actor: string
): Promise<string> {
  const updated = await getDb()
    .updateTable('mitschrift.mitschrift')
    .set({
      notes: JSON.stringify(notes),
      notes_edited: edited,
      ...(edited ? {} : { notes_stale: false, notes_at: sql<Date>`SYSUTCDATETIME()` }),
      ...touch(actor),
    })
    .where('id', '=', mitschriftId)
    .where('version', '=', requireVersion(etag))
    .output('inserted.version')
    .executeTakeFirst();
  if (!updated) throw new VersionConflictError();
  return toVersion(updated.version);
}

// --- Transcription jobs ---

type AuftragRow = Pick<
  Database['mitschrift.auftrag'],
  'source' | 'blob_name' | 'status' | 'transcription' | 'until_ms' | 'error'
> & { id: number; mitschrift_id: number; offset_ms: number; created_at: Date };

/** Deletes blob and job at Azure Speech; both may be gone already. */
async function removeAzureData(job: Pick<AuftragRow, 'blob_name' | 'transcription'>) {
  if (job.transcription) await deleteTranscription(job.transcription);
  await deleteBlobPermanently(job.blob_name);
}

/**
 * Creates a job and the link the browser uploads the audio with. `untilMs` marks the end of a
 * gap of the live recording, whose sentences the result replaces.
 */
export async function createAuftrag(
  mitschriftId: number,
  input: { source: MitschriftQuelle; offsetMs: number; untilMs: number | null },
  actor: string
): Promise<UploadTicket> {
  const meeting = await getDb()
    .selectFrom('mitschrift.mitschrift')
    .select('id')
    .where('id', '=', mitschriftId)
    .executeTakeFirst();
  if (!meeting) throw new RecordNotFoundError();
  const blobName = `mitschriften/${mitschriftId}/${randomUUID()}`;
  const row = await getDb()
    .insertInto('mitschrift.auftrag')
    .values({
      mitschrift_id: mitschriftId,
      source: input.source,
      blob_name: blobName,
      status: 'hochladen',
      transcription: null,
      offset_ms: input.offsetMs,
      until_ms: input.untilMs,
      error: null,
      created_by: actor,
    })
    .output(['inserted.id', 'inserted.created_at'])
    .executeTakeFirstOrThrow();
  return {
    auftrag: toAuftrag({
      ...row,
      source: input.source,
      status: 'hochladen',
      offset_ms: input.offsetMs,
      until_ms: input.untilMs,
      error: null,
    }),
    uploadUrl: await createUploadUrl(blobName, UPLOAD_MINUTES),
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      // The lifecycle rule of the storage account deletes tagged blobs after a day
      'x-ms-tags': 'mitschrift=audio',
    },
  };
}

async function getAuftrag(mitschriftId: number, auftragId: number): Promise<AuftragRow> {
  const job = await getDb()
    .selectFrom('mitschrift.auftrag')
    .select(AUFTRAG_COLUMNS)
    .where('id', '=', auftragId)
    .where('mitschrift_id', '=', mitschriftId)
    .executeTakeFirst();
  if (!job) throw new RecordNotFoundError();
  return job;
}

/** Starts the transcription of an uploaded file. */
export async function startAuftrag(mitschriftId: number, auftragId: number): Promise<void> {
  const job = await getAuftrag(mitschriftId, auftragId);
  if (job.status !== 'hochladen') return;
  if (!(await getBlobSize(job.blob_name))) {
    throw new ValidationError({ datei: 'Die Datei ist nicht angekommen. Bitte erneut hochladen.' });
  }
  const readUrl = await createReadUrl(job.blob_name, CONFIG.mitschriften.maxJobHours * 60);
  const prefix = PREVIEW_DATABASE ? `${PREVIEW_DATABASE}-` : '';
  const transcription = await startTranscription(
    readUrl,
    `${prefix}mitschrift-${mitschriftId}-${auftragId}`
  );
  const result = await getDb()
    .updateTable('mitschrift.auftrag')
    .set({ status: 'laeuft', transcription })
    .where('id', '=', auftragId)
    .where('status', '=', 'hochladen')
    .executeTakeFirst();
  // Started twice at the same time: the other request's job counts
  if (Number(result.numUpdatedRows) === 0) await deleteTranscription(transcription);
}

/** Stores the sentences of a finished job; marks it `erledigt` in the same transaction. */
async function storeResult(job: AuftragRow, phrases: BatchPhrase[]): Promise<void> {
  await inTransaction(async (trx) => {
    const meeting = await lockMitschrift(trx, job.mitschrift_id);
    const current = await trx
      .selectFrom('mitschrift.auftrag')
      .select('status')
      .where('id', '=', job.id)
      .executeTakeFirst();
    if (current?.status !== 'laeuft') return;

    // A gap of the live recording: its result replaces what was recognized there before
    if (job.until_ms !== null) {
      await trx
        .deleteFrom('mitschrift.abschnitt')
        .where('mitschrift_id', '=', job.mitschrift_id)
        .where('source', '=', job.source)
        .where('start_ms', '>=', job.offset_ms)
        .where('start_ms', '<', job.until_ms)
        .execute();
    }
    const keyOf = (speaker: number): string => `a${job.id}:${speaker}`;
    const speakers = await ensureSprecher(
      trx,
      job.mitschrift_id,
      [...new Set(phrases.flatMap((p) => (p.speaker === null ? [] : [p.speaker])))].map(
        (speaker) => ({ source: job.source, key: keyOf(speaker) })
      )
    );
    await insertAbschnitte(
      trx,
      job.mitschrift_id,
      phrases.map((phrase) => {
        const start = job.offset_ms + phrase.offsetMs;
        return {
          sprecher_id:
            phrase.speaker === null
              ? null
              : (speakers.get(`${job.source}|${keyOf(phrase.speaker)}`) ?? null),
          source: job.source,
          start_ms: start,
          end_ms: start + phrase.durationMs,
          text: phrase.text.slice(0, 4000),
          client_id: null,
        };
      })
    );
    await trx
      .updateTable('mitschrift.auftrag')
      .set({ status: 'erledigt' })
      .where('id', '=', job.id)
      .execute();
    // An uploaded file is the whole transcript; once it is there the Mitschrift is finished
    const status: MitschriftStatus = meeting.status === 'datei' ? 'fertig' : meeting.status;
    await trx
      .updateTable('mitschrift.mitschrift')
      .set({
        status,
        notes_stale: sql<boolean>`CASE WHEN notes IS NULL THEN 0 ELSE 1 END`,
        updated_at: sql<Date>`SYSUTCDATETIME()`,
      })
      .where('id', '=', job.mitschrift_id)
      .execute();
  });
}

/** Deletes blob and job at Azure; on errors the job stays and is tried again later. */
async function tryRemoveAzureData(job: AuftragRow): Promise<boolean> {
  try {
    await removeAzureData(job);
    return true;
  } catch {
    return false;
  }
}

async function failAuftrag(job: AuftragRow, error: string): Promise<void> {
  await getDb()
    .updateTable('mitschrift.auftrag')
    .set({ status: 'fehler', error: error.slice(0, 300) })
    .where('id', '=', job.id)
    .execute();
  // Otherwise removed with the job, at the latest by `cleanupStaleAuftraege`
  await tryRemoveAzureData(job);
}

/**
 * Advances the running jobs of a Mitschrift: stores the result of finished ones and deletes
 * their blob and job right away, marks failed ones (their blob is deleted, too). Returns true
 * if a result was stored.
 */
export async function checkAuftraege(mitschriftId: number): Promise<boolean> {
  const jobs = await getDb()
    .selectFrom('mitschrift.auftrag')
    .select(AUFTRAG_COLUMNS)
    .where('mitschrift_id', '=', mitschriftId)
    .where('status', 'in', ['laeuft', 'erledigt'])
    .execute();
  let stored = false;
  for (const job of jobs) {
    if (job.status === 'laeuft' && job.transcription) {
      const state = await getTranscription(job.transcription);
      if (state.status === 'running') continue;
      if (state.status === 'failed') {
        await failAuftrag(job, state.error);
        continue;
      }
      await storeResult(job, state.phrases);
      stored = true;
    }
    // The result is stored; the audio goes right away. If that fails, the next check retries.
    if (await tryRemoveAzureData(job)) {
      await getDb().deleteFrom('mitschrift.auftrag').where('id', '=', job.id).execute();
    }
  }
  return stored;
}

/** Cancels a job or dismisses a failed one; its blob and job at Azure Speech are deleted. */
export async function removeAuftrag(mitschriftId: number, auftragId: number): Promise<void> {
  const job = await getAuftrag(mitschriftId, auftragId);
  await removeAzureData(job);
  await getDb().deleteFrom('mitschrift.auftrag').where('id', '=', job.id).execute();
}

/**
 * Removes jobs older than `CONFIG.mitschriften.maxJobHours` with their blobs, e.g. an upload
 * that was never finished or a job whose result nobody fetched. Errors of single jobs are
 * skipped, so one broken job does not block the page; they are tried again next time.
 */
export async function cleanupStaleAuftraege(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CONFIG.mitschriften.maxJobHours * 3_600_000);
  const jobs = await getDb()
    .selectFrom('mitschrift.auftrag')
    .select(AUFTRAG_COLUMNS)
    .where('created_at', '<', cutoff)
    .execute();
  let removed = 0;
  for (const job of jobs) {
    // Tried again on the next call if Azure fails
    if (!(await tryRemoveAzureData(job))) continue;
    await getDb().deleteFrom('mitschrift.auftrag').where('id', '=', job.id).execute();
    removed++;
  }
  return removed;
}
