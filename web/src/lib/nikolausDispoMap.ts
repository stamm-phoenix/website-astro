import { minutesToTime } from './nikolausDispo';
import type { DispoRoute } from './nikolausDispo';
import type { StaffNikolausBooking } from './types';

export type LatLon = [number, number];

/** One drive of a team: from the base or a visit to the next visit or back to the base. */
export interface DispoMapLeg {
  /** Name of the starting point, e.g. `Familie Müller` or the name of the base. */
  from: string;
  to: string;
  /** Minutes since midnight. */
  departure: number;
  arrival: number;
  driveMinutes: number;
  /** Course of the drive; at least the two end points. */
  points: LatLon[];
}

/** A visit on the map, with what the map shows when pointing at it. */
export interface DispoMapStop {
  id: string;
  team: string;
  /** Position in the team's route, starting at 1. */
  number: number;
  booking: StaffNikolausBooking;
  position: LatLon;
  arrival: number;
  start: number;
  end: number;
  lateInSlot: number;
  lateAfterSlot: number;
  fixed: boolean;
  visited: boolean;
  /** Helpers of the team with a negative tag that matches the family. */
  conflicts: { name: string; tags: string[] }[];
}

export interface DispoMapTeam {
  name: string;
  color: string;
  stops: DispoMapStop[];
  legs: DispoMapLeg[];
  /** Visits without a place on the map; their drives are left out. */
  unlocated: StaffNikolausBooking[];
  departure: number | null;
  returnTime: number | null;
  driveMinutes: number;
}

function distance(a: LatLon, b: LatLon): number {
  // Close enough for nearby points: degrees of longitude shrink with the latitude
  const scale = Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) * scale);
}

/**
 * Cuts the course of a whole route (base → visits → base) into one piece per drive. The cut
 * points follow the course in route order and lie as close to the visits as possible taken
 * together, so a road driven out and back is not cut on the way back for an earlier visit.
 * Without a course the drives are straight lines.
 */
export function splitRoutePath(path: LatLon[] | null, points: LatLon[]): LatLon[][] {
  if (points.length < 2) return [];
  if (!path || path.length < 2) {
    return points.slice(1).map((point, i) => [points[i], point]);
  }
  const visits = points.slice(1, -1);
  // cost[i]: smallest total distance of the visits so far with the last one cut at path[i];
  // from[v][i]: where the visit before was cut for that
  let cost: number[] = path.map((_, i) => (i === 0 ? 0 : Infinity));
  const from: number[][] = [];
  for (const visit of visits) {
    const next: number[] = [];
    const back: number[] = [];
    let best = Infinity;
    let bestAt = 0;
    for (let i = 0; i < path.length; i++) {
      if (cost[i] < best) {
        best = cost[i];
        bestAt = i;
      }
      next.push(best + distance(path[i], visit));
      back.push(bestAt);
    }
    cost = next;
    from.push(back);
  }
  const cuts = [path.length - 1];
  if (visits.length > 0) {
    let at = 0;
    for (let i = 1; i < cost.length; i++) if (cost[i] < cost[at]) at = i;
    for (let v = visits.length - 1; v >= 0; v--) {
      cuts.unshift(at);
      at = from[v][at];
    }
  }
  cuts.unshift(0);
  return cuts.slice(1).map((cut, i) => {
    const piece = path.slice(cuts[i], cut + 1);
    // A visit right on the previous point still gets a line between the two places
    return piece.length >= 2 ? piece : [points[i], points[i + 1]];
  });
}

interface TeamSource {
  route: DispoRoute;
  color: string;
  base: { name: string; lat: number; lon: number };
  stopsById: ReadonlyMap<string, StaffNikolausBooking>;
  /** Index of each booking in the travel matrix (`stops[i]` → `i + 1`). */
  travelIndex: ReadonlyMap<string, number>;
  travel: number[][];
  path: LatLon[] | null;
  fixed: Record<string, string>;
  visited: ReadonlySet<string>;
  conflicts?: (booking: StaffNikolausBooking, team: string) => DispoMapStop['conflicts'];
}

/** Everything the map shows of one team: its visits and its drives with their times. */
export function dispoMapTeam(source: TeamSource): DispoMapTeam {
  const { route, base, stopsById } = source;
  const home: LatLon = [base.lat, base.lon];
  const stops: DispoMapStop[] = [];
  const unlocated: StaffNikolausBooking[] = [];
  route.stops.forEach((planned, i) => {
    const booking = stopsById.get(planned.id);
    if (!booking) return;
    if (!booking.location) {
      unlocated.push(booking);
      return;
    }
    stops.push({
      id: planned.id,
      team: route.team,
      number: i + 1,
      booking,
      position: [booking.location.lat, booking.location.lon],
      arrival: planned.arrival,
      start: planned.start,
      end: planned.end,
      lateInSlot: planned.lateInSlot,
      lateAfterSlot: planned.lateAfterSlot,
      fixed: source.fixed[planned.id] === route.team,
      visited: source.visited.has(planned.id),
      conflicts: source.conflicts?.(booking, route.team) ?? [],
    });
  });

  const legs: DispoMapLeg[] = [];
  // The course along the roads includes the visits without a place, so it only fits when all
  // visits are on the map; otherwise the drives are straight lines
  const path = unlocated.length === 0 ? source.path : null;
  if (stops.length > 0 && route.departure !== null && route.returnTime !== null) {
    const pieces = splitRoutePath(path, [home, ...stops.map((stop) => stop.position), home]);
    let departure = route.departure;
    let from = base.name;
    stops.forEach((stop, i) => {
      const planned = route.stops.find((s) => s.id === stop.id);
      // After a visit without a place the drive starts there, which the map cannot show
      const previous = route.stops[route.stops.findIndex((s) => s.id === stop.id) - 1];
      const startsUnlocated = previous !== undefined && !stops.some((s) => s.id === previous.id);
      if (planned && !startsUnlocated) {
        legs.push({
          from,
          to: `Familie ${stop.booking.familyName}`,
          departure,
          arrival: planned.arrival,
          driveMinutes: planned.driveMinutes,
          points: pieces[i],
        });
      }
      departure = stop.end;
      from = `Familie ${stop.booking.familyName}`;
    });
    const last = route.stops[route.stops.length - 1];
    const lastStop = stops[stops.length - 1];
    if (last.id === lastStop.id) {
      const index = source.travelIndex.get(last.id);
      legs.push({
        from,
        to: base.name,
        departure: lastStop.end,
        arrival: route.returnTime,
        driveMinutes: index === undefined ? 0 : (source.travel[index]?.[0] ?? 0),
        points: pieces[pieces.length - 1],
      });
    }
  }

  return {
    name: route.team,
    color: source.color,
    stops,
    legs,
    unlocated,
    departure: route.departure,
    returnTime: route.returnTime,
    driveMinutes: route.driveMinutes,
  };
}

/** `17:05 → 17:17 · 12 Min Fahrt` */
export function legSummary(leg: DispoMapLeg): string {
  return `${minutesToTime(leg.departure)} → ${minutesToTime(leg.arrival)} · ${Math.round(leg.driveMinutes)} Min Fahrt`;
}
