import { minutesToTime, timeToMinutes, visitMinutes } from './nikolaus-dispo';

/** A visit of the Dispo as needed for the progress of a team's route. */
export interface ProgressRow {
  bookingId: string;
  team: string;
  order: number;
  /** Planned arrival `HH:MM`. */
  plannedArrival: string;
  visited: boolean;
  /** `HH:MM` when the team checked the visit off, i.e. when it left. */
  visitedAt: string;
  childrenCount: number;
}

/** How far a team's route has come, seen from one family. Nothing about the other families. */
export interface VisitProgress {
  /** Position of the family in the team's route, starting at 1. */
  position: number;
  /** Visits of the team still to come before the family's. */
  stopsAhead: number;
  /** Whether the team has checked off any visit yet. */
  started: boolean;
  plannedArrival: string;
  /** Expected arrival `HH:MM`, corrected by the team's delay and rounded up to 5 minutes. */
  eta: string;
  /** Minutes the team is behind the plan (0 if on time). */
  delayMinutes: number;
  visited: boolean;
  visitedAt: string;
}

const ETA_STEP_MINUTES = 5;

/**
 * Progress of the route of the family's team.
 *
 * The delay is the larger of two estimates: how much later than planned the team left its last
 * checked-off visit, and – by the clock – how much later than planned it is leaving its next
 * visit. The expected arrival is never before the planned one and never in the past.
 * @param nowMinutes Current local time in minutes after midnight.
 * @returns `null` if the family is not in the Dispo.
 */
export function computeVisitProgress(
  rows: ProgressRow[],
  bookingId: string,
  nowMinutes: number
): VisitProgress | null {
  const own = rows.find((row) => row.bookingId === bookingId);
  if (!own || !own.plannedArrival) return null;

  const route = rows
    .filter((row) => row.team === own.team && row.plannedArrival)
    .sort((a, b) => a.order - b.order);
  const plannedEnd = (row: ProgressRow): number =>
    timeToMinutes(row.plannedArrival) + visitMinutes(row.childrenCount);

  const done = route.filter((row) => row.visited && /^\d{2}:\d{2}$/.test(row.visitedAt));
  const last = done.reduce<ProgressRow | null>(
    (latest, row) =>
      !latest || timeToMinutes(row.visitedAt) > timeToMinutes(latest.visitedAt) ? row : latest,
    null
  );
  const next = route.find((row) => !row.visited);

  const delay = Math.max(
    0,
    last ? timeToMinutes(last.visitedAt) - plannedEnd(last) : 0,
    next ? nowMinutes - plannedEnd(next) : 0
  );
  const planned = timeToMinutes(own.plannedArrival);
  const expected = Math.max(planned + delay, nowMinutes);

  return {
    position: route.indexOf(own) + 1,
    stopsAhead: route.filter((row) => row.order < own.order && !row.visited).length,
    started: route.some((row) => row.visited),
    plannedArrival: own.plannedArrival,
    eta: minutesToTime(Math.ceil(expected / ETA_STEP_MINUTES) * ETA_STEP_MINUTES),
    delayMinutes: Math.round(delay),
    visited: own.visited,
    visitedAt: own.visitedAt,
  };
}
