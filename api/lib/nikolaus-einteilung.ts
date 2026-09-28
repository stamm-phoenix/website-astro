/**
 * Einteilung for the Nikolausdienst: distributes the helpers to the posts of the teams.
 *
 * Shared between the API and the web frontend (imported via `web/src/lib/nikolausEinteilung.ts`),
 * so it must stay free of imports and Node/browser specific APIs.
 *
 * All days are solved together as one min-cost flow, which gives the exact optimum:
 *   source → person (one arc per day, each further day costs more: spreads the workload)
 *          → person on a day (capacity 1: one post per day)
 *          → post (day, team, role), only if the person volunteered for the role that day and
 *            none of their negative tags matches a family on the team's route
 *          → sink
 * The weights are strictly ranked: filled posts by importance first (one more Nikolaus beats
 * every combination of lower posts), then the spread of the workload, then positive tags.
 * The kitchen is not optimised: everybody who volunteered for it and is not needed in a team
 * works in the kitchen that day.
 */

/** Team posts in order of importance. */
export const TEAM_ROLES = ['Nikolaus', 'Krampus', 'Fahrer*in', 'Engerl'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const KITCHEN = 'Küche';
export type HelperRole = TeamRole | typeof KITCHEN;

/** All posts a helper can volunteer for, in order of importance. */
export const HELPER_ROLES: HelperRole[] = [...TEAM_ROLES, KITCHEN];

export interface EinteilungPerson {
  id: string;
  name: string;
  /** Posts per day (`YYYY-MM-DD`) the person would take. */
  availability: Record<string, HelperRole[]>;
  positiveTags: string[];
  negativeTags: string[];
}

export interface EinteilungDay {
  date: string;
  /** Team names of the day, e.g. `['A', 'B']`. */
  teams: string[];
  /**
   * Tags of the families per team (one array per family) from the saved Dispo, or `null` if
   * no Dispo is saved for the day; tags are then not checked.
   */
  familyTags: Record<string, string[][]> | null;
}

export interface EinteilungAssignment {
  personId: string;
  date: string;
  /** Team name, or `Küche`. */
  team: string;
  role: HelperRole;
  /** Set by hand; kept when recalculating. */
  fixed: boolean;
}

export type OpenReason = 'NOBODY' | 'ALL_BUSY' | 'ONLY_TAG_CONFLICTS';

export interface OpenPost {
  date: string;
  team: string;
  role: TeamRole;
  reason: OpenReason;
}

export interface TagConflict {
  personId: string;
  date: string;
  team: string;
  /** The negative tags that match a family of the team. */
  tags: string[];
}

export interface EinteilungResult {
  /** Team posts and kitchen. */
  assignments: EinteilungAssignment[];
  open: OpenPost[];
  /** Per day: persons who volunteered but have no task. */
  idle: Record<string, string[]>;
  /** Assignments that break a negative tag (only possible by hand or after Dispo changes). */
  conflicts: TagConflict[];
}

export interface EinteilungProblem {
  persons: EinteilungPerson[];
  days: EinteilungDay[];
  /** Team posts set by hand. */
  fixed?: EinteilungAssignment[];
}

export const OPEN_REASON_LABELS: Record<OpenReason, string> = {
  NOBODY: 'Niemand hat sich für diesen Posten gemeldet.',
  ALL_BUSY: 'Alle, die sich gemeldet haben, sind an dem Tag schon eingeteilt.',
  ONLY_TAG_CONFLICTS: 'Nur Personen mit passendem negativem Tag sind noch frei.',
};

/** Normalises a tag for comparisons: trimmed, lower case, single spaces. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

/** Splits a comma separated tag list into unique, trimmed tags (keeping the first spelling). */
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ');
    const key = normalizeTag(tag);
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/** Negative tags of a person that match a family on the team's route. */
export function conflictingTags(
  person: Pick<EinteilungPerson, 'negativeTags'>,
  families: string[][] | undefined
): string[] {
  if (!families || person.negativeTags.length === 0) return [];
  const familyTags = new Set(families.flat().map(normalizeTag));
  return person.negativeTags.filter((tag) => familyTags.has(normalizeTag(tag)));
}

/** Number of families on the route with one of the person's positive tags. */
export function positiveMatches(
  person: Pick<EinteilungPerson, 'positiveTags'>,
  families: string[][] | undefined
): number {
  if (!families || person.positiveTags.length === 0) return 0;
  const wanted = new Set(person.positiveTags.map(normalizeTag));
  return families.filter((tags) => tags.some((tag) => wanted.has(normalizeTag(tag)))).length;
}

// --- Min-cost flow ---

interface Edge {
  to: number;
  capacity: number;
  cost: number;
}

class FlowGraph {
  edges: Edge[] = [];
  adjacency: number[][] = [];

  node(): number {
    this.adjacency.push([]);
    return this.adjacency.length - 1;
  }

  /** Adds an edge and its residual twin; returns the index of the edge. */
  edge(from: number, to: number, capacity: number, cost: number): number {
    this.adjacency[from].push(this.edges.length);
    this.edges.push({ to, capacity, cost });
    this.adjacency[to].push(this.edges.length);
    this.edges.push({ to: from, capacity: 0, cost: -cost });
    return this.edges.length - 2;
  }

  /**
   * Successive shortest paths (Bellman-Ford / SPFA): augments along the cheapest path as long
   * as it lowers the total cost. Stops at the minimum cost, not at maximum flow.
   */
  minCost(source: number, sink: number): void {
    const count = this.adjacency.length;
    for (;;) {
      const distance = new Array<number>(count).fill(Infinity);
      const via = new Array<number>(count).fill(-1);
      const queued = new Array<boolean>(count).fill(false);
      distance[source] = 0;
      const queue = [source];
      queued[source] = true;
      while (queue.length > 0) {
        const node = queue.shift() as number;
        queued[node] = false;
        for (const index of this.adjacency[node]) {
          const edge = this.edges[index];
          if (edge.capacity <= 0) continue;
          const next = distance[node] + edge.cost;
          if (next < distance[edge.to]) {
            distance[edge.to] = next;
            via[edge.to] = index;
            if (!queued[edge.to]) {
              queued[edge.to] = true;
              queue.push(edge.to);
            }
          }
        }
      }
      if (!(distance[sink] < 0)) return;
      // All capacities are 1 on the path through a post, so one unit per round
      for (let node = sink; node !== source;) {
        const index = via[node];
        this.edges[index].capacity -= 1;
        this.edges[index ^ 1].capacity += 1;
        node = this.edges[index ^ 1].to;
      }
    }
  }
}

interface Post {
  date: string;
  team: string;
  role: TeamRole;
}

function postKey(post: Pick<Post, 'date' | 'team' | 'role'>): string {
  return `${post.date}|${post.team}|${post.role}`;
}

function volunteers(person: EinteilungPerson, date: string, role: HelperRole): boolean {
  return (person.availability[date] ?? []).includes(role);
}

/** Calculates the Einteilung of all days. */
export function solveEinteilung(problem: EinteilungProblem): EinteilungResult {
  const { persons, days } = problem;
  const personById = new Map(persons.map((p) => [p.id, p]));
  const posts: Post[] = days.flatMap((day) =>
    day.teams.flatMap((team) => TEAM_ROLES.map((role) => ({ date: day.date, team, role })))
  );
  const postKeys = new Set(posts.map(postKey));

  // Fixed posts: valid ones only, at most one per person and day and one person per post
  const fixed: EinteilungAssignment[] = [];
  const takenPosts = new Set<string>();
  const busy = new Set<string>();
  for (const assignment of problem.fixed ?? []) {
    const key = postKey(assignment as Post);
    const personDay = `${assignment.personId}|${assignment.date}`;
    if (!postKeys.has(key) || !personById.has(assignment.personId)) continue;
    if (takenPosts.has(key) || busy.has(personDay)) continue;
    takenPosts.add(key);
    busy.add(personDay);
    fixed.push({ ...assignment, fixed: true });
  }
  const fixedDays = new Map<string, number>();
  for (const assignment of fixed) {
    fixedDays.set(assignment.personId, (fixedDays.get(assignment.personId) ?? 0) + 1);
  }

  // Weights: tags < workload < Engerl < Fahrer*in < Krampus < Nikolaus
  const maxFamilies = Math.max(
    1,
    ...days.flatMap((day) => Object.values(day.familyTags ?? {}).map((f) => f.length))
  );
  const tagMax = posts.length * maxFamilies;
  const workloadUnit = tagMax + 1;
  const workloadMax = persons.length * ((days.length * (days.length - 1)) / 2) * workloadUnit;
  const roleWeight: Record<TeamRole, number> = {} as Record<TeamRole, number>;
  let weight = workloadMax + tagMax + 1;
  for (const role of [...TEAM_ROLES].reverse()) {
    roleWeight[role] = weight;
    weight = (posts.length + 1) * weight;
  }

  const graph = new FlowGraph();
  const source = graph.node();
  const sink = graph.node();
  const postNodes = new Map<string, number>();
  for (const post of posts) {
    const key = postKey(post);
    if (takenPosts.has(key)) continue;
    const node = graph.node();
    postNodes.set(key, node);
    graph.edge(node, sink, 1, 0);
  }

  const assignmentEdges: { index: number; personId: string; post: Post }[] = [];
  for (const person of persons) {
    const personNode = graph.node();
    const freeDays = days.filter(
      (day) =>
        !busy.has(`${person.id}|${day.date}`) &&
        TEAM_ROLES.some((role) => volunteers(person, day.date, role))
    );
    // Each further day costs more than the one before
    const already = fixedDays.get(person.id) ?? 0;
    freeDays.forEach((_, k) => graph.edge(source, personNode, 1, (already + k) * workloadUnit));

    for (const day of freeDays) {
      const dayNode = graph.node();
      graph.edge(personNode, dayNode, 1, 0);
      for (const team of day.teams) {
        const families = day.familyTags?.[team];
        if (conflictingTags(person, families).length > 0) continue;
        const bonus = positiveMatches(person, families);
        for (const role of TEAM_ROLES) {
          if (!volunteers(person, day.date, role)) continue;
          const post = { date: day.date, team, role };
          const target = postNodes.get(postKey(post));
          if (target === undefined) continue;
          const index = graph.edge(dayNode, target, 1, -(roleWeight[role] + bonus));
          assignmentEdges.push({ index, personId: person.id, post });
        }
      }
    }
  }

  graph.minCost(source, sink);

  const assignments: EinteilungAssignment[] = [...fixed];
  for (const { index, personId, post } of assignmentEdges) {
    if (graph.edges[index].capacity === 0) {
      assignments.push({ personId, ...post, fixed: false });
    }
  }
  return completeEinteilung(problem, assignments);
}

/**
 * Derives kitchen, idle persons, open posts and tag conflicts for given team assignments.
 * Used after solving and after changes by hand.
 */
export function completeEinteilung(
  problem: EinteilungProblem,
  teamAssignments: EinteilungAssignment[]
): EinteilungResult {
  const { persons, days } = problem;
  const personById = new Map(persons.map((p) => [p.id, p]));
  const teamOnly = teamAssignments.filter((a) => a.team !== KITCHEN);
  const inTeam = new Set(teamOnly.map((a) => `${a.personId}|${a.date}`));
  const filled = new Set(teamOnly.map((a) => postKey(a as Post)));

  const kitchen: EinteilungAssignment[] = [];
  const idle: Record<string, string[]> = {};
  const open: OpenPost[] = [];
  const conflicts: TagConflict[] = [];

  for (const day of days) {
    idle[day.date] = [];
    for (const person of persons) {
      const roles = person.availability[day.date] ?? [];
      if (roles.length === 0 || inTeam.has(`${person.id}|${day.date}`)) continue;
      if (roles.includes(KITCHEN)) {
        kitchen.push({
          personId: person.id,
          date: day.date,
          team: KITCHEN,
          role: KITCHEN,
          fixed: false,
        });
      } else {
        idle[day.date].push(person.id);
      }
    }

    for (const team of day.teams) {
      const families = day.familyTags?.[team];
      for (const role of TEAM_ROLES) {
        if (filled.has(postKey({ date: day.date, team, role }))) continue;
        const candidates = persons.filter((p) => volunteers(p, day.date, role));
        let reason: OpenReason = 'NOBODY';
        if (candidates.length > 0) {
          const free = candidates.filter((p) => !inTeam.has(`${p.id}|${day.date}`));
          reason =
            free.length > 0 && free.every((p) => conflictingTags(p, families).length > 0)
              ? 'ONLY_TAG_CONFLICTS'
              : 'ALL_BUSY';
        }
        open.push({ date: day.date, team, role, reason });
      }
    }
  }

  for (const assignment of teamOnly) {
    const person = personById.get(assignment.personId);
    const day = days.find((d) => d.date === assignment.date);
    if (!person || !day) continue;
    const tags = conflictingTags(person, day.familyTags?.[assignment.team]);
    if (tags.length > 0)
      conflicts.push({ personId: person.id, date: day.date, team: assignment.team, tags });
  }

  return { assignments: [...teamOnly, ...kitchen], open, idle, conflicts };
}

/**
 * Rating of an Einteilung as a vector to compare lexicographically (higher is better):
 * filled posts per role in order of importance, then minus the workload penalty, then positive
 * tag matches. Used by tests and to show whether a manual change made things worse.
 */
export function rateEinteilung(problem: EinteilungProblem, result: EinteilungResult): number[] {
  const personById = new Map(problem.persons.map((p) => [p.id, p]));
  const team = result.assignments.filter((a) => a.team !== KITCHEN);
  const filled = TEAM_ROLES.map((role) => team.filter((a) => a.role === role).length);
  const perPerson = new Map<string, number>();
  for (const a of team) perPerson.set(a.personId, (perPerson.get(a.personId) ?? 0) + 1);
  const workload = [...perPerson.values()].reduce((sum, n) => sum + (n * (n - 1)) / 2, 0);
  const tags = team.reduce((sum, a) => {
    const person = personById.get(a.personId);
    const day = problem.days.find((d) => d.date === a.date);
    return sum + (person && day ? positiveMatches(person, day.familyTags?.[a.team]) : 0);
  }, 0);
  return [...filled, -workload, tags];
}
