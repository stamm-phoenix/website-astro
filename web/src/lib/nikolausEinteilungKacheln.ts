/**
 * Moving the person tiles of the Einteilung: a person is one tile per day, so a person holds at
 * most one post per day. The draft keeps the team posts and the persons put aside; the kitchen
 * follows from `completeEinteilung`.
 */
import { HELPER_ROLES, KITCHEN } from './nikolausEinteilung';
import type {
  EinteilungAssignment,
  EinteilungPerson,
  EinteilungProblem,
  EinteilungResult,
  HelperRole,
  TeamRole,
} from './nikolausEinteilung';

/**
 * Persons put aside per day (`YYYY-MM-DD`): they get no post that day, not even the kitchen,
 * and recalculating leaves them out.
 */
export type Parked = Record<string, string[]>;

/** Where a tile can be dropped: a team post, the kitchen or the box „Ohne Posten“. */
export type TileTarget = PostTarget | typeof KITCHEN | 'parken';

/** A team post a tile can be dropped on; `null` takes the person out of the teams. */
export interface PostTarget {
  team: string;
  role: TeamRole;
}

/** The posts a person volunteered for that day, in order of importance. */
export function rolesOn(person: EinteilungPerson | undefined, date: string): HelperRole[] {
  const roles = person?.availability[date] ?? [];
  return HELPER_ROLES.filter((role) => roles.includes(role));
}

export function canTake(person: EinteilungPerson | undefined, date: string, role: TeamRole): boolean {
  return rolesOn(person, date).includes(role);
}

/**
 * Puts a person on a post of the day, or out of the teams with `target` `null`. Someone already
 * on that post moves to the person's former post if they volunteered for it, otherwise out of
 * the teams. A person who did not volunteer for the post is not placed, and held (`fixed`)
 * posts stay as they are: only the pin holds a post.
 */
export function placePerson(
  assignments: EinteilungAssignment[],
  persons: Map<string, EinteilungPerson>,
  date: string,
  personId: string,
  target: PostTarget | null
): EinteilungAssignment[] {
  const current = assignments.find((a) => a.date === date && a.personId === personId);
  if (current?.fixed) return assignments;
  if (target === null) return current ? assignments.filter((a) => a !== current) : assignments;
  if (!canTake(persons.get(personId), date, target.role)) return assignments;
  if (current?.team === target.team && current.role === target.role) return assignments;
  const occupant = assignments.find(
    (a) => a.date === date && a.team === target.team && a.role === target.role
  );
  if (occupant?.fixed) return assignments;
  const rest = assignments.filter((a) => a !== current && a !== occupant);
  const placed: EinteilungAssignment = { personId, date, ...target, fixed: false };
  if (
    occupant &&
    current &&
    canTake(persons.get(occupant.personId), date, current.role as TeamRole)
  ) {
    return [...rest, placed, { ...occupant, team: current.team, role: current.role }];
  }
  return [...rest, placed];
}

/**
 * Moves a person's tile on a day: onto a team post (see `placePerson`), into the kitchen (only
 * who volunteered for it) or into the box „Ohne Posten“.
 */
export function moveTile(
  assignments: EinteilungAssignment[],
  parked: Parked,
  persons: Map<string, EinteilungPerson>,
  date: string,
  personId: string,
  target: TileTarget
): { assignments: EinteilungAssignment[]; parked: Parked } {
  if (assignments.some((a) => a.date === date && a.personId === personId && a.fixed)) {
    return { assignments, parked };
  }
  const parkedToday = parked[date] ?? [];
  const withParked = (ids: string[]): Parked => {
    const rest = Object.fromEntries(Object.entries(parked).filter(([day]) => day !== date));
    return ids.length > 0 ? { ...rest, [date]: ids } : rest;
  };
  const unparked = withParked(parkedToday.filter((id) => id !== personId));
  if (target === 'parken') {
    return {
      assignments: placePerson(assignments, persons, date, personId, null),
      parked: parkedToday.includes(personId) ? parked : withParked([...parkedToday, personId]),
    };
  }
  if (target === KITCHEN) {
    if (!rolesOn(persons.get(personId), date).includes(KITCHEN)) return { assignments, parked };
    return {
      assignments: placePerson(assignments, persons, date, personId, null),
      parked: unparked,
    };
  }
  const next = placePerson(assignments, persons, date, personId, target);
  return next === assignments ? { assignments, parked } : { assignments: next, parked: unparked };
}

/**
 * The persons put aside in a saved Einteilung: on a day with saved rows, who volunteered for
 * the kitchen but has no row was taken out of it by hand.
 */
export function parkedFromRows(
  persons: EinteilungPerson[],
  rows: Pick<EinteilungAssignment, 'personId' | 'date'>[]
): Parked {
  const parked: Parked = {};
  const days = new Set(rows.map((row) => row.date));
  const placed = new Set(rows.map((row) => `${row.personId}|${row.date}`));
  for (const date of [...days].sort()) {
    const ids = persons
      .filter((p) => rolesOn(p, date).includes(KITCHEN) && !placed.has(`${p.id}|${date}`))
      .map((p) => p.id);
    if (ids.length > 0) parked[date] = ids;
  }
  return parked;
}

/** The problem without the days on which persons are put aside, for recalculating. */
export function withoutParked(problem: EinteilungProblem, parked: Parked): EinteilungProblem {
  return {
    ...problem,
    persons: problem.persons.map((person) => {
      const days = Object.keys(parked).filter((date) => parked[date].includes(person.id));
      if (days.length === 0) return person;
      const availability = { ...person.availability };
      for (const date of days) delete availability[date];
      return { ...person, availability };
    }),
  };
}

/** Moves the persons put aside from the kitchen to the persons without a post. */
export function applyParked(result: EinteilungResult, parked: Parked): EinteilungResult {
  const isParked = (a: EinteilungAssignment): boolean =>
    a.team === KITCHEN && (parked[a.date] ?? []).includes(a.personId);
  const idle = { ...result.idle };
  for (const a of result.assignments.filter(isParked)) {
    idle[a.date] = [...(idle[a.date] ?? []), a.personId];
  }
  return { ...result, assignments: result.assignments.filter((a) => !isParked(a)), idle };
}

/** How often a person works over all days, in total and per post. */
export interface Einsaetze {
  total: number;
  byRole: Partial<Record<HelperRole, number>>;
}

/** Counts the posts per person over all days, the kitchen included. */
export function countEinsaetze(assignments: EinteilungAssignment[]): Map<string, Einsaetze> {
  const counts = new Map<string, Einsaetze>();
  for (const { personId, role } of assignments) {
    const entry = counts.get(personId) ?? { total: 0, byRole: {} };
    entry.total += 1;
    entry.byRole[role] = (entry.byRole[role] ?? 0) + 1;
    counts.set(personId, entry);
  }
  return counts;
}
