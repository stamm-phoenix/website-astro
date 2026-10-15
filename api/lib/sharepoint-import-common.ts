import { CONFIG } from './config';
import type { Db } from './db';
import { isDatabaseOverridden } from './db';
import { PREVIEW_DATABASE } from './deployment';
import { SharePointRestError, getListItemAttachment } from './sharepoint-rest';

/**
 * Helpers shared by the takeovers of the SharePoint lists (`sharepoint-import.ts` and the
 * `sharepoint-import-*.ts` of the single lists).
 */

export type ImportList = 'gruppenstunden' | 'leitende' | 'aktionen' | 'belege' | 'instagram';

export interface ImportSummary {
  items: number;
  /** Lists with photos: photos copied, and the IDs whose photo could not be read. */
  photos?: number;
  missingPhotos?: string[];
  /** Choices added to the options of the form (teams, Stufen). */
  addedTeams?: string[];
  addedStufen?: string[];
  /** Aktionen: entries whose CampFlow event was already linked to an earlier entry. */
  unlinked?: string[];
}

export interface ListItem<T> {
  id: string;
  createdDateTime?: string;
  fields: T;
}

/** Rows per INSERT, well below the 2100 parameters SQL Server allows. */
const CHUNK = 100;

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

export function itemId(id: string): number {
  if (!/^\d{1,9}$/.test(id)) throw new Error(`Unexpected SharePoint item ID ${id}`);
  return Number(id);
}

/**
 * A `YYYY-MM-DD` date (also the date part of a SharePoint date), or null. Only days that exist
 * and that a SQL `date` holds: `Date` would turn `2026-02-30` into March 2, which SQL refuses.
 */
export function dateOrNull(value: unknown): string | null {
  const date = text(value).split('T')[0] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '0001-01-01') return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

/** File name referenced by an image column (JSON with `fileName`), if any. */
export function imageFileName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const fileName = (JSON.parse(value) as { fileName?: unknown } | null)?.fileName;
    return typeof fileName === 'string' && fileName ? fileName : undefined;
  } catch {
    return undefined;
  }
}

/** Values of a choice column that may hold one or several values, without duplicates. */
export function choices(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.map(text).filter(Boolean))];
}

/** An attachment of a list item, or undefined if SharePoint does not have it. */
export async function readAttachment(
  listId: string,
  id: number,
  fileName: string
): Promise<Uint8Array | undefined> {
  try {
    return await getListItemAttachment(listId, String(id), fileName);
  } catch (error: unknown) {
    if (error instanceof SharePointRestError && error.status === 404) return undefined;
    throw error;
  }
}

/**
 * Only the website itself copies, into its configured production database: previews (and the
 * preview server) only ever hold invented data, and scripts and tests that point the pool at
 * another database (`useDatabase`) never copy production data into it.
 */
export function mayImport(): boolean {
  return (
    PREVIEW_DATABASE === null &&
    CONFIG.database.server !== CONFIG.database.previewServer &&
    !isDatabaseOverridden()
  );
}

export async function isImported(db: Db, list: ImportList): Promise<boolean> {
  const row = await db
    .selectFrom('content.sharepoint_import')
    .select('list')
    .where('list', '=', list)
    .executeTakeFirst();
  return row !== undefined;
}

export async function markImported(
  db: Db,
  list: ImportList,
  summary: ImportSummary
): Promise<void> {
  await db
    .insertInto('content.sharepoint_import')
    .values({ list, summary: JSON.stringify(summary) })
    .execute();
}

export function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) {
    result.push(items.slice(start, start + CHUNK));
  }
  return result;
}

export type ImportedTable =
  'content.gruppenstunde' | 'content.leitende' | 'content.aktion' | 'organisation.beleg';

export async function assertEmpty(db: Db, table: ImportedTable): Promise<void> {
  const row = await db.selectFrom(table).select('id').executeTakeFirst();
  if (row) throw new Error(`${table} is not empty; the SharePoint import expects no rows`);
}

export async function countRows(db: Db, table: ImportedTable): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * Runs `work` for every item with at most `concurrency` at a time. It waits for all running work
 * before it throws the first error, so nothing is still writing when the caller cleans up.
 */
export async function forEachLimited<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  };
  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
