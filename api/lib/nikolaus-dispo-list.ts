import { createHash } from 'node:crypto';
import {
  deleteSharePointListItem,
  getGraphStatus,
  getSharePointListItems,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  mutateNikolausState,
  readNikolausState,
  listNikolausStates,
  NikolausStateConflictError,
} from './nikolaus-state';
import { hasFields, parsePlanSnapshot } from './nikolaus-plan-snapshot';
import {
  getDispoVisitRetentionPolicy,
  mergeRetentionSeasonPolicy,
  retentionScheduleKey,
} from './nikolaus-retention-schedule';
import type { RetentionSeasonPolicy } from './nikolaus-retention-schedule';

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
  /** Actual server completion timestamp (ISO); imported legacy rows may contain `HH:MM`. */
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

function planKey(date: string): string {
  return `planning:dispo:${date}`;
}

function isDispoRow(value: unknown): value is DispoRow {
  return hasFields(
    value,
    ['id', 'etag', 'bookingId', 'date', 'team', 'slotKey', 'plannedArrival', 'visitedAt'],
    ['fixed', 'visited'],
    ['order']
  );
}

async function getLegacyRows(): Promise<DispoRow[]> {
  const items = await getSharePointListItems(getListId(), { expand: 'fields' });
  return items.map(mapRow);
}

/** Snapshot plans replace legacy rows for the entire date, including an empty plan. */
export async function getAllDispoRows(): Promise<DispoRow[]> {
  const [legacy, states] = await Promise.all([
    getLegacyRows(),
    listNikolausStates('planning:dispo:'),
  ]);
  const savedDates = new Set(states.map((state) => state.key.slice('planning:dispo:'.length)));
  return [
    ...legacy.filter((row) => !savedDates.has(row.date)),
    ...states.flatMap((state) => parsePlanSnapshot(state.data, [], isDispoRow).rows),
  ];
}

export async function getDispoRows(date: string): Promise<DispoRow[]> {
  const state = await readNikolausState(planKey(date));
  const legacy = state ? [] : (await getLegacyRows()).filter((row) => row.date === date);
  return parsePlanSnapshot(state?.data, legacy, isDispoRow).rows.sort(
    (a, b) => a.team.localeCompare(b.team) || a.order - b.order
  );
}

/**
 * Fingerprint of the planning as loaded. Saving compares it with the current rows, so a Dispo
 * changed by someone else in the meantime is not overwritten. Built from the planned fields
 * instead of the etags, so teams checking off visits do not block saving the Dispo.
 */
export function getDispoVersion(rows: DispoRow[]): string {
  const parts = rows
    .map((row) =>
      JSON.stringify([
        row.id,
        row.bookingId,
        row.team,
        row.order,
        row.slotKey,
        row.plannedArrival,
        row.fixed,
      ])
    )
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

async function preserveVisitDeadlines(rows: DispoRow[]): Promise<void> {
  const policies = new Map<number, RetentionSeasonPolicy>();
  for (const row of rows) {
    const observed = getDispoVisitRetentionPolicy(row);
    if (observed) {
      policies.set(
        observed.season,
        mergeRetentionSeasonPolicy(policies.get(observed.season), observed)
      );
    }
  }
  for (const observed of policies.values()) {
    await mutateNikolausState(
      retentionScheduleKey(observed.season),
      (current) => current,
      (current) => mergeRetentionSeasonPolicy(current, observed)
    );
  }
}

/** Visit progress retains its complete timestamp in the CAS plan, including after rescheduling. */
export async function setDispoVisited(
  row: DispoRow,
  visited: boolean,
  visitedAt: string
): Promise<void> {
  const legacy = await getDispoRows(row.date);
  const matching = legacy.filter((entry) => entry.bookingId === row.bookingId);
  if (matching.length === 0) throw new NikolausStateConflictError();
  // Metadata commits first. A crash can postpone cleanup, but cannot shorten its deadline.
  // Existing timestamps are also captured before unvisit and before adopting legacy rows.
  await preserveVisitDeadlines([
    ...legacy,
    ...(visited ? matching.map((entry) => ({ ...entry, visitedAt })) : []),
  ]);
  await mutateNikolausState(
    planKey(row.date),
    (value) => parsePlanSnapshot(value, legacy, isDispoRow),
    (current) => {
      if (!current.rows.some((entry) => entry.bookingId === row.bookingId)) {
        throw new NikolausStateConflictError();
      }
      return {
        schema: 1 as const,
        rows: current.rows.map((entry) =>
          entry.bookingId === row.bookingId
            ? { ...entry, visited, visitedAt: visited ? visitedAt : '' }
            : entry
        ),
      };
    }
  );
}

/**
 * Saves one full date in one conditional write. Retrying the same desired plan is a no-op,
 * even when the previous HTTP response was lost after SharePoint committed the write.
 */
export async function saveDispo(
  date: string,
  entries: DispoEntry[],
  existing: DispoRow[],
  expectedVersion: string = getDispoVersion(existing)
): Promise<void> {
  const legacy = await getDispoRows(date);
  await preserveVisitDeadlines(legacy);
  await mutateNikolausState(
    planKey(date),
    (value) => parsePlanSnapshot(value, legacy, isDispoRow),
    (current) => {
      const byBooking = new Map(current.rows.map((row) => [row.bookingId, row]));
      const rows = entries.map((entry): DispoRow => {
        const old = byBooking.get(entry.bookingId);
        return {
          ...entry,
          date,
          id: old?.id ?? `dispo:${date}:${entry.bookingId}`,
          etag: '',
          visited: old?.visited ?? false,
          visitedAt: old?.visitedAt ?? '',
        };
      });
      if (getDispoVersion(rows) === getDispoVersion(current.rows)) return undefined;
      if (getDispoVersion(current.rows) !== expectedVersion) throw new NikolausStateConflictError();
      return { schema: 1 as const, rows };
    }
  );
}

/** Remove dependents before deleting their booking. Snapshots precede legacy cleanup. */
export async function deleteDispoOfBooking(bookingId: string): Promise<void> {
  const [legacy, states] = await Promise.all([
    getLegacyRows(),
    listNikolausStates('planning:dispo:'),
  ]);
  const legacyMatches = legacy.filter((row) => row.bookingId === bookingId);
  if (legacyMatches.some((row) => !row.etag || row.etag === '*')) {
    throw new NikolausStateConflictError();
  }
  const dates = new Set(legacyMatches.map((row) => row.date));
  const visits = [...legacyMatches];
  for (const state of states) {
    const plan = parsePlanSnapshot(state.data, [], isDispoRow);
    if (plan.rows.some((row) => row.bookingId === bookingId)) {
      dates.add(state.key.slice('planning:dispo:'.length));
      visits.push(...plan.rows.filter((row) => row.bookingId === bookingId));
    }
  }
  await preserveVisitDeadlines(visits);
  for (const date of dates) {
    await mutateNikolausState(
      planKey(date),
      (value) =>
        parsePlanSnapshot(
          value,
          legacy.filter((row) => row.date === date),
          isDispoRow
        ),
      (current) =>
        current.rows.some((row) => row.bookingId === bookingId)
          ? { schema: 1 as const, rows: current.rows.filter((row) => row.bookingId !== bookingId) }
          : undefined
    );
  }
  for (const row of legacyMatches) {
    try {
      await deleteSharePointListItem(getListId(), row.id, row.etag);
    } catch (error: unknown) {
      if (getGraphStatus(error) === 404) continue;
      if (getGraphStatus(error) === 412) throw new NikolausStateConflictError();
      throw error;
    }
  }
}
