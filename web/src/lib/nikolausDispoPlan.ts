import { NIKOLAUS_SLOT_MINUTES } from './nikolausConfig';
import { conflictingTags } from './nikolausEinteilung';
import { timeToMinutes, visitMinutes, moveStop, evaluateDispo } from './nikolausDispo';
import type { DispoProblem, DispoAssignment } from './nikolausDispo';
import type { StaffNikolausBooking, StaffNikolausDispoData } from './types';

/** Negative tags of a team's helpers that match a family's tags. */
export function tagConflicts(
  source: StaffNikolausDispoData,
  booking: StaffNikolausBooking,
  team: string
): { name: string; tags: string[] }[] {
  return (source.members[team] ?? []).flatMap((member) => {
    const tags = conflictingTags(member, [booking.internalTags]);
    return tags.length > 0 ? [{ name: member.name, tags }] : [];
  });
}

export function toProblem(source: StaffNikolausDispoData): DispoProblem {
  // Families must not go to a team with a helper who has a matching negative tag
  const forbidden: Record<string, string[]> = {};
  for (const booking of source.stops) {
    const teams = source.teams
      .map((team) => team.name)
      .filter((team) => tagConflicts(source, booking, team).length > 0);
    if (teams.length > 0) forbidden[booking.id] = teams;
  }
  return {
    forbidden,
    stops: source.stops.map((booking) => {
      const slotStart = timeToMinutes(booking.slotKey.split('T')[1] ?? '00:00');
      return {
        id: booking.id,
        slotStart,
        slotEnd: slotStart + NIKOLAUS_SLOT_MINUTES,
        duration: visitMinutes(booking.childrenCount),
      };
    }),
    teams: source.teams.map((team) => team.name),
    travel: source.travel,
  };
}

/** Puts a stop into the team where it adds the least cost. */
export function insertCheapest(
  target: DispoProblem,
  current: DispoAssignment,
  id: string
): DispoAssignment {
  let best = current;
  let bestCost = Infinity;
  for (const team of target.teams) {
    const candidate = moveStop(target, current, id, team);
    const cost = evaluateDispo(target, candidate).cost;
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

interface DispoDraft {
  assignment: DispoAssignment;
  fixed: Record<string, string>;
  changes: string[];
}
/** Reconcile saved rows with today's bookings, inserting new stops at the cheapest position. */
export function restoreDispoDraft(source: StaffNikolausDispoData): DispoDraft {
  const target = toProblem(source);
  const bookings = new Map(source.stops.map((stop) => [stop.id, stop]));
  const next: DispoAssignment = Object.fromEntries(target.teams.map((team) => [team, []]));
  const nextFixed: Record<string, string> = {};
  const hints: string[] = [];
  const sorted = [...source.rows].sort((a, b) => a.order - b.order);
  for (const row of sorted) {
    const booking = bookings.get(row.bookingId);
    if (!booking) {
      hints.push(
        `Ein gespeicherter Termin (Buchung ${row.bookingId}) ist nicht mehr bestätigt oder wurde auf einen anderen Tag verlegt. Er wird beim Speichern aus der Dispo entfernt.`
      );
      continue;
    }
    if (!next[row.team]) {
      hints.push(
        `Familie ${booking.familyName} war Team ${row.team} zugeordnet, das es an diesem Tag nicht mehr gibt.`
      );
      continue;
    }
    next[row.team].push(row.bookingId);
    if (row.fixed) nextFixed[row.bookingId] = row.team;
    if (row.slotKey !== booking.slotKey) {
      hints.push(
        `Familie ${booking.familyName} wurde seit dem Speichern auf ${booking.slotKey.split('T')[1]} Uhr verlegt – am besten neu berechnen.`
      );
    }
  }

  let merged = next;
  for (const stop of source.stops) {
    if (!Object.values(merged).some((ids) => ids.includes(stop.id))) {
      merged = insertCheapest(target, merged, stop.id);
      const team = Object.keys(merged).find((name) => merged[name].includes(stop.id));
      hints.push(`Neuer Termin: Familie ${stop.familyName} wurde Team ${team} zugeordnet.`);
    }
  }

  return { assignment: merged, fixed: nextFixed, changes: hints };
}
