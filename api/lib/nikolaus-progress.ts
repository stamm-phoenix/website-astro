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
  /**
   * Expected arrival `HH:MM`, corrected by the team's delay and rounded up to 5 minutes;
   * `null` if it passed more than a few minutes ago – the check-offs are then out of date and
   * neither the time nor the number of visits ahead can be trusted.
   */
  eta: string | null;
  /** Minutes the team is behind the plan (0 if on time). */
  delayMinutes: number;
  visited: boolean;
  visitedAt: string;
}

const ETA_STEP_MINUTES = 5;
/** Upper limit of the delay estimated from the clock alone (one slot). */
const MAX_CLOCK_DELAY_MINUTES = 30;
/** For this long after the expected arrival, the current time is shown instead. */
const OVERDUE_GRACE_MINUTES = 15;

/**
 * Progress of the route of the family's team.
 *
 * The delay is the larger of two estimates: how much later than planned the team left its last
 * checked-off visit, and – by the clock – how much later than planned it is leaving its next
 * visit (only once the team checks off, and capped). The expected arrival is never before the
 * planned one.
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

  // By the clock only once the team checks off visits, and at most one slot: a team that
  // forgets to check off would otherwise seem to fall further and further behind
  const byClock =
    last && next ? Math.min(MAX_CLOCK_DELAY_MINUTES, nowMinutes - plannedEnd(next)) : 0;
  const delay = Math.max(0, last ? timeToMinutes(last.visitedAt) - plannedEnd(last) : 0, byClock);
  const planned = timeToMinutes(own.plannedArrival);
  const expected = planned + delay;

  return {
    position: route.indexOf(own) + 1,
    stopsAhead: route.filter((row) => row.order < own.order && !row.visited).length,
    started: route.some((row) => row.visited),
    plannedArrival: own.plannedArrival,
    eta:
      nowMinutes - expected > OVERDUE_GRACE_MINUTES
        ? null
        : minutesToTime(
            Math.ceil(Math.max(expected, nowMinutes) / ETA_STEP_MINUTES) * ETA_STEP_MINUTES
          ),
    delayMinutes: Math.round(delay),
    visited: own.visited,
    visitedAt: own.visitedAt,
  };
}
