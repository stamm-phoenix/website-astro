import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import { getKeineAktionen } from './aktion-art';
import type { CampflowEvent } from './campflow';
import { getCampflowEvents } from './campflow';
import { nextContentId } from './content-ids';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  getSqlErrorNumber,
  inTransaction,
  requireVersion,
  toDateString,
  toVersion,
} from './db';
import type { AktionTable, Database } from './db-schema';
import type { AktionInput } from './pflege-validation';
import { LEITENDE_STUFE, STUFEN } from './pflege-validation';

/**
 * The calendar entries in Azure SQL (`content.aktion` with their Stufen in
 * `content.aktion_stufe`, migration `0026_aktionen_belege_instagram.sql`).
 */

export interface Aktion {
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string | undefined;
  description?: string | undefined;
  start: string;
  end: string;
  /** CampFlow event the entry was published from; its title, dates and link win. */
  campflowId?: string | undefined;
}

/** Fields of a calendar entry that CampFlow owns for linked entries. */
export interface CampflowOwnedFields {
  title: string;
  start: string;
  end: string;
  campflow_link?: string | undefined;
}

const EVENT_CACHE_TTL_MS = 5 * 60 * 1000;
const EVENT_RETRY_AFTER_MS = 60 * 1000;

export function isLeitendeOnly(aktion: Aktion): boolean {
  return aktion.stufen.length === 1 && aktion.stufen.every((s) => s === 'Leitende');
}

const BERLIN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day of a CampFlow date: `YYYY-MM-DD` stays as is, a timestamp becomes its date in
 * Europe/Berlin; anything else is `null`.
 */
export function campflowDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : BERLIN_DATE.format(date);
}

/**
 * Title, dates and registration link of a CampFlow event. Missing values fall back to `copy`,
 * the values stored with the entry.
 */
export function campflowOverlay(
  event: CampflowEvent,
  copy?: Partial<CampflowOwnedFields>
): CampflowOwnedFields {
  const eventStart = campflowDateOnly(event.start_date);
  const eventEnd = campflowDateOnly(event.end_date);
  const start = eventStart ?? eventEnd ?? copy?.start ?? '';
  return {
    title: event.title.trim() || copy?.title || '',
    start,
    end: eventEnd ?? (eventStart ? start : (copy?.end ?? start)),
    campflow_link: event.url ?? copy?.campflow_link,
  };
}

/** Events of the last request; `null` while CampFlow failed and nothing was loaded before. */
let eventCache: { events: Map<string, CampflowEvent> | null; expires: number } | undefined;
let pendingEvents: Promise<Map<string, CampflowEvent> | null> | undefined;

/** Forgets the cached CampFlow events (for tests). */
export function resetCampflowEventCache(): void {
  eventCache = undefined;
  pendingEvents = undefined;
}

/**
 * CampFlow events by id, cached for a few minutes. If CampFlow fails, the last result is served;
 * without one `null` is returned and the stored copies are used.
 */
function cachedCampflowEvents(): Promise<Map<string, CampflowEvent> | null> {
  if (eventCache && eventCache.expires > Date.now()) return Promise.resolve(eventCache.events);
  pendingEvents ??= getCampflowEvents()
    .then((events) => {
      const map = new Map(events.map((event) => [event.id, event]));
      eventCache = { events: map, expires: Date.now() + EVENT_CACHE_TTL_MS };
      return map;
    })
    .catch(() => {
      // Retry later instead of making every request wait for the failing CampFlow again
      eventCache = {
        events: eventCache?.events ?? null,
        expires: Date.now() + EVENT_RETRY_AFTER_MS,
      };
      return eventCache.events;
    })
    .finally(() => {
      pendingEvents = undefined;
    });
  return pendingEvents;
}

/** A calendar entry as the edit module loads it. */
export interface StaffAktion {
  id: string;
  etag: string;
  campflowId: string | null;
  title: string;
  stufen: string[];
  start: string;
  end: string;
  link: string;
  description: string;
}

/** Order of the Stufen: the four Stufen, Leitende, then the others by name. */
function sortStufen(stufen: readonly string[]): string[] {
  const fixed = [...STUFEN, LEITENDE_STUFE];
  const rank = (stufe: string): number => {
    const index = fixed.indexOf(stufe);
    return index === -1 ? fixed.length : index;
  };
  return [...stufen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'de'));
}

function dateText(value: Date | string | null): string {
  return value === null ? '' : toDateString(value);
}

/** All entries with their Stufen, read in one statement so version and Stufen match. */
export async function getStaffAktionen(): Promise<StaffAktion[]> {
  const rows = await getDb()
    .selectFrom('content.aktion as a')
    .leftJoin('content.aktion_stufe as s', 's.aktion_id', 'a.id')
    .selectAll('a')
    .select('s.stufe')
    .orderBy('a.id')
    .execute();
  const entries = new Map<number, { row: Selectable<AktionTable>; stufen: string[] }>();
  for (const { stufe, ...row } of rows) {
    const entry = entries.get(row.id) ?? { row, stufen: [] };
    if (stufe !== null) entry.stufen.push(stufe);
    entries.set(row.id, entry);
  }
  return [...entries.values()].map(({ row, stufen }) => ({
    id: String(row.id),
    etag: toVersion(row.version),
    campflowId: row.campflow_id,
    title: row.title,
    stufen: sortStufen(stufen),
    start: dateText(row.start_date),
    end: dateText(row.end_date),
    link: row.link,
    description: row.description,
  }));
}

/** Reads the calendar entries as stored, without CampFlow data. */
export async function getStoredAktionen(): Promise<Aktion[]> {
  return (await getStaffAktionen()).map((entry) => ({
    id: entry.id,
    stufen: entry.stufen,
    title: entry.title,
    campflow_link: entry.link || undefined,
    description: entry.description || undefined,
    start: entry.start,
    end: entry.end,
    campflowId: entry.campflowId ?? undefined,
  }));
}

/** The Stufen to choose from in the form. */
export async function getAktionStufen(): Promise<string[]> {
  const rows = await getDb().selectFrom('content.aktion_stufe_option').select('name').execute();
  return sortStufen(rows.map((row) => row.name));
}

function toColumns(input: AktionInput): {
  title: string;
  start_date: string | null;
  end_date: string | null;
  link: string;
  description: string;
  campflow_id: string | null;
} {
  return {
    title: input.title,
    start_date: input.start || null,
    end_date: input.end || input.start || null,
    link: input.link,
    description: input.description,
    campflow_id: input.campflowId,
  };
}

async function writeStufen(
  trx: Transaction<Database>,
  id: number,
  stufen: readonly string[]
): Promise<void> {
  await trx.deleteFrom('content.aktion_stufe').where('aktion_id', '=', id).execute();
  if (stufen.length === 0) return;
  await trx
    .insertInto('content.aktion_stufe')
    .values(stufen.map((stufe) => ({ aktion_id: id, stufe })))
    .execute();
}

/** Another entry is linked to the same CampFlow event (`uq_aktion_campflow_id`). */
function isDuplicateCampflowId(error: unknown): boolean {
  const number = getSqlErrorNumber(error);
  return (
    (number === 2601 || number === 2627) &&
    error instanceof Error &&
    error.message.includes('uq_aktion_campflow_id')
  );
}

async function linkedTwice<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (isDuplicateCampflowId(error)) throw new VersionConflictError();
    throw error;
  }
}

export async function createAktion(input: AktionInput, actor: string): Promise<string> {
  return linkedTwice(() =>
    inTransaction(async (trx) => {
      const id = await nextContentId(trx, 'content.aktion');
      await trx
        .insertInto('content.aktion')
        .values({ id, ...toColumns(input), updated_by: actor })
        .execute();
      await writeStufen(trx, id, input.stufen);
      return String(id);
    })
  );
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('content.aktion')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves an entry with its Stufen if it still has the version `etag`. */
export async function updateAktion(
  id: number,
  input: AktionInput,
  etag: string,
  actor: string
): Promise<void> {
  const updated = await linkedTwice(() =>
    inTransaction(async (trx) => {
      const result = await trx
        .updateTable('content.aktion')
        .set({ ...toColumns(input), updated_by: actor, updated_at: sql<Date>`SYSUTCDATETIME()` })
        .where('id', '=', id)
        .where('version', '=', requireVersion(etag))
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) return false;
      await writeStufen(trx, id, input.stufen);
      return true;
    })
  );
  if (!updated) await notChanged(id);
}

/** Deletes an entry if it still has the version `etag`; CampFlow is not touched. */
export async function deleteAktion(id: number, etag: string): Promise<void> {
  const result = await getDb()
    .deleteFrom('content.aktion')
    .where('id', '=', id)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(id);
}

/**
 * Calendar entries for the public pages. Entries linked to a CampFlow event take title, dates
 * and registration link live from CampFlow; the stored copy is the fallback. Entries of events
 * marked as no real Aktion (e.g. an order of jumpers) are left out.
 */
export async function getAktionen(): Promise<Aktion[]> {
  const stored = await getStoredAktionen();
  if (!stored.some((a) => a.campflowId)) return stored;
  const keineAktionen = await getKeineAktionen();
  const aktionen = stored.filter((a) => !a.campflowId || !keineAktionen.has(a.campflowId));

  const events = await cachedCampflowEvents();
  if (!events) return aktionen;

  return aktionen.map((aktion) => {
    const event = aktion.campflowId ? events.get(aktion.campflowId) : undefined;
    return event ? { ...aktion, ...campflowOverlay(event, aktion) } : aktion;
  });
}
