import { createHash } from 'node:crypto';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

/** One planned visit of the Dispo list (one row per booking). */
export interface DispoRow {
  id: string;
  etag: string;
  bookingId: string;
  date: string;
  team: string;
  /** Position in the team's route, starting at 1. */
  order: number;
  /** Slot of the booking when the Dispo was saved; differs if it was moved since. */
  slotKey: string;
  /** Planned arrival `HH:MM`. */
  plannedArrival: string;
  /** Set by hand; kept when the Dispo is recalculated. */
  fixed: boolean;
  visited: boolean;
  /** `HH:MM`, set by the Fahrt view when the team checks off the visit. */
  visitedAt: string;
}

/** What the Leitendenbereich saves per visit. */
export interface DispoEntry {
  bookingId: string;
  team: string;
  order: number;
  slotKey: string;
  plannedArrival: string;
  fixed: boolean;
}

interface DispoListItem {
  id: string;
  eTag?: string;
  fields?: {
    Title?: string;
    Datum?: string;
    Team?: string;
    Reihenfolge?: number;
    SlotKey?: string;
    GeplanteAnkunft?: string;
    Fixiert?: boolean;
    Besucht?: boolean;
    BesuchtUm?: string;
  };
}

/** Parallel requests when saving; SharePoint throttles larger bursts. */
const SAVE_CONCURRENCY = 4;

function getListId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_DISPO_LIST_ID);
}

function mapRow(item: unknown): DispoRow {
  const listItem = item as DispoListItem;
  const fields = listItem.fields ?? {};
  return {
    id: String(listItem.id),
    etag: listItem.eTag ?? '',
    bookingId: (fields.Title ?? '').trim(),
    date: fields.Datum ?? '',
    team: fields.Team ?? '',
    order: Number(fields.Reihenfolge ?? 0),
    slotKey: fields.SlotKey ?? '',
    plannedArrival: fields.GeplanteAnkunft ?? '',
    fixed: fields.Fixiert === true,
    visited: fields.Besucht === true,
    visitedAt: fields.BesuchtUm ?? '',
  };
}

/** All Dispo rows of all days. The list is small, so it is filtered here instead of in SharePoint. */
export async function getAllDispoRows(): Promise<DispoRow[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapRow);
}

/** All Dispo rows of a day. */
export async function getDispoRows(date: string): Promise<DispoRow[]> {
  return (await getAllDispoRows())
    .filter((row) => row.date === date)
    .sort((a, b) => a.team.localeCompare(b.team) || a.order - b.order);
}

/**
 * Fingerprint of the planning as loaded. Saving compares it with the current rows, so a Dispo
 * changed by someone else in the meantime is not overwritten. Built from the planned fields
 * instead of the etags, so teams checking off visits do not block saving the Dispo.
 */
export function getDispoVersion(rows: DispoRow[]): string {
  const parts = rows
    .map((row) =>
      [row.id, row.bookingId, row.team, row.order, row.slotKey, row.plannedArrival, row.fixed].join(
        ':'
      )
    )
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Marks a visit as done (with the local time `HH:MM`) or undoes it. */
export async function setDispoVisited(
  row: DispoRow,
  visited: boolean,
  visitedAt: string
): Promise<void> {
  await updateSharePointListItem(getListId(), row.id, {
    Besucht: visited,
    BesuchtUm: visited ? visitedAt : '',
  });
}

function entryFields(date: string, entry: DispoEntry): Record<string, unknown> {
  return {
    Title: entry.bookingId,
    Datum: date,
    Team: entry.team,
    Reihenfolge: entry.order,
    SlotKey: entry.slotKey,
    GeplanteAnkunft: entry.plannedArrival,
    Fixiert: entry.fixed,
  };
}

function isUnchanged(row: DispoRow, entry: DispoEntry): boolean {
  return (
    row.team === entry.team &&
    row.order === entry.order &&
    row.slotKey === entry.slotKey &&
    row.plannedArrival === entry.plannedArrival &&
    row.fixed === entry.fixed
  );
}

async function runLimited(tasks: (() => Promise<unknown>)[]): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, tasks.length) }, worker));
}

/**
 * Replaces the Dispo of a day: rows are updated in place, so `Besucht`/`BesuchtUm` survive,
 * missing ones are created and rows of bookings no longer planned are deleted.
 */
export async function saveDispo(
  date: string,
  entries: DispoEntry[],
  existing: DispoRow[]
): Promise<void> {
  const listId = getListId();
  const byBooking = new Map<string, DispoRow>();
  const surplus: DispoRow[] = [];
  for (const row of existing) {
    if (byBooking.has(row.bookingId)) surplus.push(row);
    else byBooking.set(row.bookingId, row);
  }

  const tasks: (() => Promise<unknown>)[] = [];
  const planned = new Set<string>();
  for (const entry of entries) {
    planned.add(entry.bookingId);
    const row = byBooking.get(entry.bookingId);
    if (!row) {
      tasks.push(() =>
        createSharePointListItem(listId, { ...entryFields(date, entry), Besucht: false })
      );
    } else if (!isUnchanged(row, entry)) {
      tasks.push(() =>
        updateSharePointListItem(listId, row.id, entryFields(date, entry), row.etag || undefined)
      );
    }
  }
  for (const row of [...byBooking.values()].filter((r) => !planned.has(r.bookingId))) {
    surplus.push(row);
  }
  for (const row of surplus) {
    tasks.push(() => deleteSharePointListItem(listId, row.id, row.etag || undefined));
  }

  await runLimited(tasks);
}
