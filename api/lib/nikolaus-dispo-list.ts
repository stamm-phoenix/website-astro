import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { DispoVisitTable } from './db-schema';
import { getDb, getSqlErrorNumber, inTransaction, lockResource, toDateString } from './db';
import type { Db } from './db';
import { NikolausStateConflictError } from './nikolaus-state';
import { assertTeamsConfigured, dispoLock as planLock } from './nikolaus-settings';

/** One planned visit of the Dispo (one row per booking and day). */
export interface DispoRow {
  id: string;
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
  /** Server time of the check-off (ISO), empty if not visited. */
  visitedAt: string;
  /** Last accepted visit mutation, for retries of the offline queue. */
  visitOperationId?: string;
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

/** SQL Server: the row references a booking that was deleted in the meantime. */
const FOREIGN_KEY_VIOLATION = 547;

function mapRow(row: Selectable<DispoVisitTable>): DispoRow {
  const date = toDateString(row.date);
  return {
    id: `dispo:${date}:${row.booking_id}`,
    bookingId: String(row.booking_id),
    date,
    team: row.team,
    order: row.route_order,
    slotKey: row.slot_key,
    plannedArrival: row.planned_arrival,
    fixed: row.fixed,
    visited: row.visited_at !== null,
    visitedAt: row.visited_at?.toISOString() ?? '',
    ...(row.visit_operation_id ? { visitOperationId: row.visit_operation_id } : {}),
  };
}

function sortRows(rows: DispoRow[]): DispoRow[] {
  return rows.sort((a, b) => a.team.localeCompare(b.team) || a.order - b.order);
}

/** The Dispo of all days. */
export async function getAllDispoRows(db: Db = getDb()): Promise<DispoRow[]> {
  const rows = await db.selectFrom('nikolaus.dispo_visit').selectAll().execute();
  return rows.map(mapRow);
}

export async function getDispoRows(date: string, db: Db = getDb()): Promise<DispoRow[]> {
  const rows = await db
    .selectFrom('nikolaus.dispo_visit')
    .selectAll()
    .where('date', '=', date)
    .execute();
  return sortRows(rows.map(mapRow));
}

/**
 * Fingerprint of the planning as loaded. Saving compares it with the current rows, so a Dispo
 * changed by someone else in the meantime is not overwritten. Built from the planned fields
 * only, so teams checking off visits do not block saving the Dispo.
 */
export function getDispoVersion(rows: Omit<DispoRow, 'visited' | 'visitedAt'>[]): string {
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

/** Includes the assignment and visit state, so stale offline writes cannot overwrite either. */
export function getDispoVisitVersion(row: DispoRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.bookingId,
        row.date,
        row.team,
        row.order,
        row.slotKey,
        row.plannedArrival,
        row.visited,
        row.visitedAt,
        row.visitOperationId ?? '',
      ])
    )
    .digest('hex');
}

export interface DispoVisitMutation {
  operationId: string;
  version: string;
}

/**
 * Checks a visit off (or undoes it). With a mutation, a retry of the same operation returns
 * the saved row unchanged, and a change based on an older version is rejected.
 */
export async function setDispoVisited(
  row: DispoRow,
  visited: boolean,
  visitedAt: string,
  mutation?: DispoVisitMutation
): Promise<DispoRow> {
  return inTransaction(async (trx) => {
    await lockResource(trx, planLock(row.date));
    const current = await trx
      .selectFrom('nikolaus.dispo_visit')
      .selectAll()
      .where('date', '=', row.date)
      .where('booking_id', '=', Number(row.bookingId))
      .executeTakeFirst();
    if (!current) throw new NikolausStateConflictError();
    const existing = mapRow(current);
    if (mutation) {
      if (existing.visitOperationId === mutation.operationId) {
        if (existing.visited !== visited) throw new NikolausStateConflictError();
        return existing;
      }
      if (getDispoVisitVersion(existing) !== mutation.version)
        throw new NikolausStateConflictError();
    }
    const updated = await trx
      .updateTable('nikolaus.dispo_visit')
      .set({
        visited_at: visited ? new Date(visitedAt) : null,
        visit_operation_id: mutation?.operationId ?? null,
      })
      .where('date', '=', row.date)
      .where('booking_id', '=', Number(row.bookingId))
      .output([
        'inserted.date',
        'inserted.booking_id',
        'inserted.team',
        'inserted.route_order',
        'inserted.slot_key',
        'inserted.planned_arrival',
        'inserted.fixed',
        'inserted.visited_at',
        'inserted.visit_operation_id',
      ])
      .executeTakeFirstOrThrow();
    return mapRow(updated);
  });
}

/**
 * Replaces the Dispo of a day in one transaction, if nobody saved another one since the
 * caller loaded `expectedVersion`. Visits already checked off keep their state. Saving the
 * same plan again changes nothing.
 */
export async function saveDispo(
  date: string,
  entries: DispoEntry[],
  expectedVersion: string
): Promise<void> {
  try {
    await inTransaction(async (trx) => {
      await lockResource(trx, planLock(date));
      await assertTeamsConfigured(
        trx,
        entries.map((entry) => ({ date, team: entry.team }))
      );
      const current = await getDispoRows(date, trx);
      const byBooking = new Map(current.map((row) => [row.bookingId, row]));
      const desired = entries.map((entry): DispoRow => {
        const old = byBooking.get(entry.bookingId);
        return {
          ...entry,
          date,
          id: `dispo:${date}:${entry.bookingId}`,
          visited: old?.visited ?? false,
          visitedAt: old?.visitedAt ?? '',
          visitOperationId: old?.visitOperationId,
        };
      });
      if (getDispoVersion(desired) === getDispoVersion(current)) return;
      if (getDispoVersion(current) !== expectedVersion) throw new NikolausStateConflictError();
      await trx.deleteFrom('nikolaus.dispo_visit').where('date', '=', date).execute();
      for (let index = 0; index < desired.length; index += 150) {
        await trx
          .insertInto('nikolaus.dispo_visit')
          .values(
            desired.slice(index, index + 150).map((row) => ({
              date,
              booking_id: Number(row.bookingId),
              team: row.team,
              route_order: row.order,
              slot_key: row.slotKey,
              planned_arrival: row.plannedArrival,
              fixed: row.fixed,
              visited_at: row.visitedAt ? new Date(row.visitedAt) : null,
              visit_operation_id: row.visitOperationId ?? null,
            }))
          )
          .execute();
      }
    });
  } catch (error: unknown) {
    // A booking of the plan was deleted while saving
    if (getSqlErrorNumber(error) === FOREIGN_KEY_VIOLATION) throw new NikolausStateConflictError();
    throw error;
  }
}
