/**
 * Dispo for the Nikolausdienst: distributes the visits of one day to the teams and plans
 * each team's route.
 *
 * Shared between the API and the web frontend (imported via `web/src/lib/nikolausDispo.ts`),
 * so it must stay free of imports and Node/browser specific APIs. The frontend uses it to
 * re-evaluate routes after manual changes and to recalculate without a round trip.
 *
 * The families book a fixed slot, so the order of the visits is mostly given by time. What
 * is left to decide is which team takes which visit. Every route is simulated (drive, wait
 * for the slot, visit, drive on) and rated by driving time and delays; a local search with
 * several seeded restarts then looks for the cheapest distribution. With at most four teams
 * and a few dozen visits per day this takes only milliseconds.
 */

/** Minutes a visit takes per child (the rule of thumb used so far). */
export const DISPO_MINUTES_PER_CHILD = 5;

/** Shortest duration of a visit, whatever the number of children. */
export const DISPO_MIN_VISIT_MINUTES = 10;

/** Cost per minute a team arrives after the start of the booked slot. */
const COST_LATE_IN_SLOT = 3;
/** Cost per minute a team arrives after the end of the booked slot. */
const COST_LATE_AFTER_SLOT = 25;
/** Cost per minute of driving (including the way back to the base). */
const COST_DRIVING = 1;

const RESTARTS = 8;
const PERTURBATIONS = 15;
const RANDOM_SEED = 20261206;

export interface DispoStop {
  /** Booking ID. */
  id: string;
  /** Start of the booked slot in minutes since midnight. */
  slotStart: number;
  /** End of the booked slot in minutes since midnight. */
  slotEnd: number;
  /** Expected duration of the visit in minutes. */
  duration: number;
}

export interface DispoProblem {
  stops: DispoStop[];
  /** Team names, e.g. `['A', 'B']`. */
  teams: string[];
  /**
   * Driving minutes between the base and the stops: index 0 is the base, index `i + 1` is
   * `stops[i]`. `travel[from][to]`.
   */
  travel: number[][];
  /** Team assignments that must be kept (booking ID → team). */
  fixed?: Record<string, string>;
  /**
   * Teams a stop must not go to (booking ID → teams), e.g. because a helper in that team has a
   * negative tag matching the family. Ignored for a stop if it would leave no team at all.
   */
  forbidden?: Record<string, string[]>;
}

/** Ordered booking IDs per team. */
export type DispoAssignment = Record<string, string[]>;

export interface DispoPlannedStop {
  id: string;
  /** Minutes since midnight. */
  arrival: number;
  /** When the visit starts: at arrival, but not before the slot starts. */
  start: number;
  end: number;
  /** Driving minutes from the previous stop (or the base). */
  driveMinutes: number;
  /** Minutes after the start of the slot. */
  lateInSlot: number;
  /** Minutes after the end of the slot. */
  lateAfterSlot: number;
}

export interface DispoRoute {
  team: string;
  stops: DispoPlannedStop[];
  /** When the team leaves the base (minutes since midnight), `null` without stops. */
  departure: number | null;
  /** When the team is back at the base, `null` without stops. */
  returnTime: number | null;
  driveMinutes: number;
  cost: number;
}

export interface DispoPlan {
  routes: DispoRoute[];
  cost: number;
}

/** Duration of a visit for a number of children. */
export function visitMinutes(children: number): number {
  return Math.max(DISPO_MIN_VISIT_MINUTES, Math.round(children) * DISPO_MINUTES_PER_CHILD);
}

/** `HH:MM` → minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight → `HH:MM` (rounded to full minutes). */
export function minutesToTime(total: number): string {
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Index of each stop in the travel matrix, by booking ID. */
function indexStops(problem: DispoProblem): Map<string, number> {
  return new Map(problem.stops.map((stop, i) => [stop.id, i]));
}

function simulate(
  team: string,
  order: number[],
  problem: DispoProblem
): { route: DispoRoute; cost: number } {
  const { stops, travel } = problem;
  const planned: DispoPlannedStop[] = [];
  let cost = 0;
  let driveTotal = 0;
  let position = 0;
  let time = 0;
  let departure: number | null = null;

  for (const index of order) {
    const stop = stops[index];
    const drive = travel[position][index + 1];
    // The team leaves the base just in time for its first visit
    if (departure === null) {
      departure = stop.slotStart - drive;
      time = departure;
    }
    const arrival = time + drive;
    const start = Math.max(arrival, stop.slotStart);
    const lateInSlot = Math.max(0, start - stop.slotStart);
    const lateAfterSlot = Math.max(0, start - stop.slotEnd);
    const end = start + stop.duration;

    planned.push({
      id: stop.id,
      arrival,
      start,
      end,
      driveMinutes: drive,
      lateInSlot,
      lateAfterSlot,
    });
    cost += drive * COST_DRIVING + lateInSlot * COST_LATE_IN_SLOT;
    cost += lateAfterSlot * COST_LATE_AFTER_SLOT;
    driveTotal += drive;
    time = end;
    position = index + 1;
  }

  let returnTime: number | null = null;
  if (order.length > 0) {
    const back = travel[position][0];
    driveTotal += back;
    cost += back * COST_DRIVING;
    returnTime = time + back;
  }

  return {
    route: { team, stops: planned, departure, returnTime, driveMinutes: driveTotal, cost },
    cost,
  };
}

/**
 * Cost of a route, like `simulate` but without building the result. Evaluated millions of
 * times during the search, so it can leave out the stop at position `skip` and insert the
 * stop `insert` at position `at` (counted without the skipped one) without copying arrays.
 */
function routeCost(
  order: number[],
  problem: DispoProblem,
  skip = -1,
  insert = -1,
  at = -1
): number {
  const { stops, travel } = problem;
  let cost = 0;
  let position = 0;
  let time = 0;
  let visited = 0;
  let reduced = 0;

  const visit = (index: number): void => {
    const stop = stops[index];
    const drive = travel[position][index + 1];
    if (visited === 0) time = stop.slotStart - drive;
    const start = Math.max(time + drive, stop.slotStart);
    cost += drive * COST_DRIVING;
    if (start > stop.slotStart) cost += (start - stop.slotStart) * COST_LATE_IN_SLOT;
    if (start > stop.slotEnd) cost += (start - stop.slotEnd) * COST_LATE_AFTER_SLOT;
    time = start + stop.duration;
    position = index + 1;
    visited++;
  };

  for (let k = 0; k < order.length; k++) {
    if (k === skip) continue;
    if (reduced === at) visit(insert);
    visit(order[k]);
    reduced++;
  }
  if (insert >= 0 && at >= reduced) visit(insert);
  if (visited > 0) cost += travel[position][0] * COST_DRIVING;
  return cost;
}

/** Deterministic pseudo random numbers (mulberry32), so every run gives the same plan. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheapest position to insert a stop into a route, with the resulting route cost. */
function bestInsertion(
  order: number[],
  index: number,
  problem: DispoProblem
): { position: number; cost: number } {
  let best = { position: 0, cost: Infinity };
  for (let position = 0; position <= order.length; position++) {
    const cost = routeCost(order, problem, -1, index, position);
    if (cost < best.cost) best = { position, cost };
  }
  return best;
}

const allowedCache = new WeakMap<DispoProblem, number[][]>();

/** Teams a stop may be assigned to: its fixed team, or any team that is not forbidden. */
function allowedTeams(problem: DispoProblem, index: number): number[] {
  let allowed = allowedCache.get(problem);
  if (!allowed) {
    const all = problem.teams.map((_, i) => i);
    allowed = problem.stops.map((stop) => {
      const fixedIndex = problem.teams.indexOf(problem.fixed?.[stop.id] ?? '');
      if (fixedIndex >= 0) return [fixedIndex];
      const forbidden = problem.forbidden?.[stop.id] ?? [];
      const permitted = all.filter((i) => !forbidden.includes(problem.teams[i]));
      return permitted.length > 0 ? permitted : all;
    });
    allowedCache.set(problem, allowed);
  }
  return allowed[index];
}

/** Builds a first solution: visits in chronological order, each to the cheapest team. */
function construct(problem: DispoProblem, random: () => number, noise: number): number[][] {
  const routes: number[][] = problem.teams.map(() => []);
  const order = problem.stops
    .map((stop, index) => ({ index, key: stop.slotStart + random() * noise }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.index);

  for (const index of order) {
    let best = { team: -1, position: 0, delta: Infinity };
    for (const team of allowedTeams(problem, index)) {
      const before = routeCost(routes[team], problem);
      const insertion = bestInsertion(routes[team], index, problem);
      // Noise lets restarts explore other distributions
      const delta = insertion.cost - before + random() * noise;
      if (delta < best.delta) best = { team, position: insertion.position, delta };
    }
    routes[best.team].splice(best.position, 0, index);
  }
  return routes;
}

/** Improves a solution by moving and swapping visits until nothing gets cheaper. */
function improve(routes: number[][], problem: DispoProblem): number[][] {
  const costs = routes.map((order) => routeCost(order, problem));
  const EPSILON = 1e-9;
  let improved = true;

  while (improved) {
    improved = false;

    // Move one visit to another position (in the same or another team)
    for (let from = 0; from < routes.length && !improved; from++) {
      for (let i = 0; i < routes[from].length && !improved; i++) {
        const index = routes[from][i];
        const remaining = routes[from].filter((_, k) => k !== i);
        const remainingCost = routeCost(remaining, problem);
        for (const to of allowedTeams(problem, index)) {
          const base = to === from ? remaining : routes[to];
          const insertion = bestInsertion(base, index, problem);
          const newCost = to === from ? insertion.cost : remainingCost + insertion.cost;
          const oldCost = to === from ? costs[from] : costs[from] + costs[to];
          if (newCost < oldCost - EPSILON) {
            const inserted = [...base];
            inserted.splice(insertion.position, 0, index);
            if (to === from) {
              routes[from] = inserted;
              costs[from] = insertion.cost;
            } else {
              routes[from] = remaining;
              routes[to] = inserted;
              costs[from] = remainingCost;
              costs[to] = insertion.cost;
            }
            improved = true;
            break;
          }
        }
      }
    }
    if (improved) continue;

    // Exchange the rest of the evening between two teams, e.g. after an overlong visit
    for (let a = 0; a < routes.length && !improved; a++) {
      for (let b = a + 1; b < routes.length && !improved; b++) {
        for (let i = 0; i <= routes[a].length && !improved; i++) {
          for (let j = 0; j <= routes[b].length && !improved; j++) {
            const tailA = routes[a].slice(i);
            const tailB = routes[b].slice(j);
            if (tailA.length === 0 && tailB.length === 0) continue;
            if (tailA.some((index) => !allowedTeams(problem, index).includes(b))) continue;
            if (tailB.some((index) => !allowedTeams(problem, index).includes(a))) continue;
            const newA = [...routes[a].slice(0, i), ...tailB];
            const newB = [...routes[b].slice(0, j), ...tailA];
            const costA = routeCost(newA, problem);
            const costB = routeCost(newB, problem);
            if (costA + costB < costs[a] + costs[b] - EPSILON) {
              routes[a] = newA;
              routes[b] = newB;
              costs[a] = costA;
              costs[b] = costB;
              improved = true;
            }
          }
        }
      }
    }
    if (improved) continue;

    // Swap two visits of different teams (each keeps the other's position)
    for (let a = 0; a < routes.length && !improved; a++) {
      for (let b = a + 1; b < routes.length && !improved; b++) {
        for (let i = 0; i < routes[a].length && !improved; i++) {
          for (let j = 0; j < routes[b].length && !improved; j++) {
            const ia = routes[a][i];
            const ib = routes[b][j];
            if (!allowedTeams(problem, ia).includes(b)) continue;
            if (!allowedTeams(problem, ib).includes(a)) continue;
            const newA = [...routes[a]];
            const newB = [...routes[b]];
            newA[i] = ib;
            newB[j] = ia;
            const costA = routeCost(newA, problem);
            const costB = routeCost(newB, problem);
            if (costA + costB < costs[a] + costs[b] - EPSILON) {
              routes[a] = newA;
              routes[b] = newB;
              costs[a] = costA;
              costs[b] = costB;
              improved = true;
            }
          }
        }
      }
    }
  }
  return routes;
}

function toAssignment(routes: number[][], problem: DispoProblem): DispoAssignment {
  const assignment: DispoAssignment = {};
  problem.teams.forEach((team, t) => {
    assignment[team] = routes[t].map((index) => problem.stops[index].id);
  });
  return assignment;
}

/** Evaluates a given distribution: times, delays and driving per team. */
export function evaluateDispo(problem: DispoProblem, assignment: DispoAssignment): DispoPlan {
  const index = indexStops(problem);
  const routes = problem.teams.map((team) => {
    const order = (assignment[team] ?? [])
      .map((id) => index.get(id))
      .filter((i): i is number => i !== undefined);
    return simulate(team, order, problem).route;
  });
  return { routes, cost: routes.reduce((sum, route) => sum + route.cost, 0) };
}

/** Moves a few random visits to random teams, to leave a local optimum. */
function perturb(routes: number[][], problem: DispoProblem, random: () => number): number[][] {
  const next = routes.map((order) => [...order]);
  const moves = 2 + Math.floor(random() * 3);
  for (let m = 0; m < moves; m++) {
    const from = Math.floor(random() * next.length);
    if (next[from].length === 0) continue;
    const i = Math.floor(random() * next[from].length);
    const index = next[from][i];
    const teams = allowedTeams(problem, index);
    const to = teams[Math.floor(random() * teams.length)];
    next[from].splice(i, 1);
    next[to].splice(bestInsertion(next[to], index, problem).position, 0, index);
  }
  return next;
}

function totalCost(routes: number[][], problem: DispoProblem): number {
  return routes.reduce((sum, order) => sum + routeCost(order, problem), 0);
}

/** Calculates a distribution of all stops to the teams with as little driving and delay as possible. */
export function solveDispo(problem: DispoProblem): DispoAssignment {
  if (problem.teams.length === 0) return {};
  const random = createRandom(RANDOM_SEED);
  let best: number[][] = problem.teams.map(() => []);
  let bestCost = Infinity;

  for (let run = 0; run < RESTARTS; run++) {
    // The first run is purely greedy; later runs start from more and more randomised solutions
    const noise = run === 0 ? 0 : 5 + run * 2;
    let current = improve(construct(problem, random, noise), problem);
    let currentCost = totalCost(current, problem);
    // Iterated local search: shake the solution a little and keep it if it got cheaper
    for (let step = 0; step < PERTURBATIONS; step++) {
      const candidate = improve(perturb(current, problem, random), problem);
      const candidateCost = totalCost(candidate, problem);
      if (candidateCost < currentCost) {
        current = candidate;
        currentCost = candidateCost;
      }
    }
    if (currentCost < bestCost) {
      best = current;
      bestCost = currentCost;
    }
  }
  return toAssignment(best, problem);
}

/**
 * Moves one stop to another team at its cheapest position, leaving everything else as it is.
 * Used for manual changes.
 */
export function moveStop(
  problem: DispoProblem,
  assignment: DispoAssignment,
  id: string,
  team: string
): DispoAssignment {
  const index = indexStops(problem);
  const stopIndex = index.get(id);
  if (stopIndex === undefined || !problem.teams.includes(team)) return assignment;

  const next: DispoAssignment = {};
  for (const name of problem.teams) {
    next[name] = (assignment[name] ?? []).filter((other) => other !== id);
  }
  const order = next[team]
    .map((other) => index.get(other))
    .filter((i): i is number => i !== undefined);
  const { position } = bestInsertion(order, stopIndex, problem);
  next[team].splice(position, 0, id);
  return next;
}
