import { isAzureMapsConfigured, requestAzureMaps } from './azure-maps';
import { CONFIG } from './config';
import type { NikolausCoordinates } from './nikolaus-config';
import { distanceKm } from './nikolaus-config';

/** Where the driving times come from. */
export type TravelSource = 'route' | 'estimate';

export interface TravelMatrix {
  /** Driving minutes `minutes[from][to]` between the given points. */
  minutes: number[][];
  source: TravelSource;
}

export interface TravelOptions {
  /**
   * Departure (RFC 3339 with offset), so the usual traffic of that weekday and hour is
   * included. Ignored once it has passed.
   */
  departAt?: string;
}

const TIMEOUT_MS = 8000;
/**
 * All matrix requests of one Dispo load, well below the 45 seconds after which the Static Web
 * App ends an API request; what is missing then is estimated.
 */
const MATRIX_BUDGET_MS = 25_000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
/**
 * Cells of one synchronous Azure Maps matrix with a departure time. Above 100 cells all points
 * must lie within 400 × 400 km, which a service area always does.
 */
const MAX_MATRIX_CELLS = 200;
const MAX_PARALLEL_REQUESTS = 4;
const MAX_CACHED_PAIRS = 20_000;

/** Time to park and walk to the door, added to every trip. */
const PARKING_MINUTES = 2;
/** Estimate without a route: air-line distance × detour factor at an average speed. */
const DETOUR_FACTOR = 1.4;
const AVERAGE_KMH = 35;
/** Assumed trip to or from a point whose location is unknown. */
export const UNKNOWN_TRIP_MINUTES = 10;

/**
 * Driving minutes per pair of points, so a new booking only needs its own row and column;
 * `null` marks a pair without a route, which is estimated.
 */
const pairs = new Map<string, { minutes: number | null; expires: number }>();

function estimate(a: NikolausCoordinates, b: NikolausCoordinates): number {
  return (distanceKm(a, b) * DETOUR_FACTOR * 60) / AVERAGE_KMH;
}

function pointKey(point: NikolausCoordinates): string {
  return `${point.lat},${point.lon}`;
}

function pairKey(from: string, to: string, departAt: string): string {
  return `${departAt}|${from}|${to}`;
}

function cachedPair(key: string): number | null | undefined {
  const entry = pairs.get(key);
  if (!entry) return undefined;
  if (entry.expires > Date.now()) return entry.minutes;
  pairs.delete(key);
  return undefined;
}

function cachePair(key: string, minutes: number | null): void {
  pairs.delete(key);
  if (pairs.size >= MAX_CACHED_PAIRS) {
    const oldest = pairs.keys().next().value;
    if (oldest !== undefined) pairs.delete(oldest);
  }
  pairs.set(key, { minutes, expires: Date.now() + CACHE_TTL_MS });
}

function multiPoint(points: NikolausCoordinates[], pointType: 'origins' | 'destinations') {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPoint', coordinates: points.map((p) => [p.lon, p.lat]) },
    properties: { pointType },
  };
}

/** Whether a cell's status says that no route exists, unlike a failure that may pass. */
function isNoRoute(statusCode: unknown): boolean {
  return (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 429
  );
}

/**
 * Driving minutes `[origin][destination]` of one request: `null` where no route exists,
 * `undefined` where the cell failed or is missing.
 */
export function parseMatrix(
  value: unknown,
  origins: number,
  destinations: number
): (number | null | undefined)[][] {
  const cells = (value as { properties?: { matrix?: unknown } } | null)?.properties?.matrix;
  if (!Array.isArray(cells)) throw new Error('Azure Maps returned no matrix');
  // `undefined` until a cell answers: missing or failed cells are asked again next time
  const minutes: (number | null | undefined)[][] = Array.from({ length: origins }, () =>
    Array.from({ length: destinations }, () => undefined)
  );
  for (const cell of cells as unknown[]) {
    if (typeof cell !== 'object' || cell === null) continue;
    const {
      originIndex,
      destinationIndex,
      statusCode,
      durationInSeconds,
      durationTrafficInSeconds,
    } = cell as Record<string, unknown>;
    if (
      !Number.isInteger(originIndex) ||
      !Number.isInteger(destinationIndex) ||
      (originIndex as number) < 0 ||
      (originIndex as number) >= origins ||
      (destinationIndex as number) < 0 ||
      (destinationIndex as number) >= destinations
    ) {
      continue;
    }
    if (statusCode !== undefined && statusCode !== 200) {
      // A client error such as OUT_OF_REGION: there is no route between the two points
      if (isNoRoute(statusCode)) minutes[originIndex as number][destinationIndex as number] = null;
      continue;
    }
    const seconds =
      typeof durationTrafficInSeconds === 'number' ? durationTrafficInSeconds : durationInSeconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      minutes[originIndex as number][destinationIndex as number] = seconds / 60;
    }
  }
  return minutes;
}

async function fetchMatrix(
  origins: NikolausCoordinates[],
  destinations: NikolausCoordinates[],
  departAt: string | undefined,
  timeoutMs: number
): Promise<(number | null | undefined)[][]> {
  const body = await requestAzureMaps({
    method: 'POST',
    path: '/route/matrix',
    apiVersion: CONFIG.azureMaps.routeApiVersion,
    body: {
      type: 'FeatureCollection',
      features: [multiPoint(origins, 'origins'), multiPoint(destinations, 'destinations')],
      travelMode: 'driving',
      ...(departAt ? { departAt, traffic: 'historical' } : {}),
    },
    timeoutMs,
  });
  return parseMatrix(body, origins.length, destinations.length);
}

interface MatrixBlock {
  origins: string[];
  destinations: string[];
}

/** Splits `origins × destinations` into requests of at most `MAX_MATRIX_CELLS` cells. */
export function matrixBlocks(origins: string[], destinations: string[]): MatrixBlock[] {
  const blocks: MatrixBlock[] = [];
  const destinationSize = Math.min(destinations.length, MAX_MATRIX_CELLS);
  const originSize = Math.max(1, Math.floor(MAX_MATRIX_CELLS / destinationSize));
  for (let d = 0; d < destinations.length; d += destinationSize) {
    for (let o = 0; o < origins.length; o += originSize) {
      blocks.push({
        origins: origins.slice(o, o + originSize),
        destinations: destinations.slice(d, d + destinationSize),
      });
    }
  }
  return blocks;
}

/**
 * Runs the tasks with at most `MAX_PARALLEL_REQUESTS` at a time, each with the time left until
 * `deadline`; none starts after it. True if all ran and succeeded.
 */
async function runLimited(
  tasks: ((timeoutMs: number) => Promise<void>)[],
  deadline: number
): Promise<boolean> {
  let next = 0;
  let ok = true;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const left = deadline - Date.now();
      if (left <= 0) {
        console.warn('Azure Maps matrix took too long, using air-line estimate');
        next = tasks.length;
        ok = false;
        return;
      }
      const task = tasks[next++];
      try {
        await task(Math.min(TIMEOUT_MS, left));
      } catch (error: unknown) {
        ok = false;
        console.warn('Azure Maps matrix failed, using air-line estimate', error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, tasks.length) }, worker));
  return ok;
}

interface FilledPairs {
  /** Whether every pair was cached or requested successfully. */
  ok: boolean;
  /**
   * The minutes of this load by `pairKey`, kept apart from the cache, so an entry that expires
   * while the rest is requested is not silently estimated.
   */
  values: Map<string, number | null>;
}

/** Requests the pairs not cached yet. */
async function fillPairs(
  points: Map<string, NikolausCoordinates>,
  departAt: string | undefined
): Promise<FilledPairs> {
  const all = [...points.keys()];
  const time = departAt ?? 'any';
  const values = new Map<string, number | null>();
  const gaps: [string, string][] = [];
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue;
      const key = pairKey(a, b, time);
      const cached = cachedPair(key);
      if (cached === undefined) gaps.push([a, b]);
      else values.set(key, cached);
    }
  }
  if (gaps.length === 0) return { ok: true, values };
  // Points that touch every missing pair, those with the most first; for a new booking only
  // that booking. Their rows and their column from all other points are requested.
  const count = new Map<string, number>();
  for (const [a, b] of gaps) {
    count.set(a, (count.get(a) ?? 0) + 1);
    count.set(b, (count.get(b) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const point of [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))) {
    if (gaps.every(([a, b]) => missing.includes(a) || missing.includes(b))) break;
    missing.push(point);
  }
  const others = all.filter((point) => !missing.includes(point));
  // Splitting saves less than a row on a new day; then one full matrix needs fewer requests
  const splitCells = missing.length * all.length + others.length * missing.length;
  const blocks =
    splitCells > all.length * all.length - all.length
      ? matrixBlocks(all, all)
      : [...matrixBlocks(missing, all), ...matrixBlocks(others, missing)];
  const deadline = Date.now() + MATRIX_BUDGET_MS;
  const ok = await runLimited(
    blocks.map((block) => async (timeoutMs) => {
      const minutes = await fetchMatrix(
        block.origins.map((key) => points.get(key) as NikolausCoordinates),
        block.destinations.map((key) => points.get(key) as NikolausCoordinates),
        departAt,
        timeoutMs
      );
      let failed = 0;
      block.origins.forEach((from, i) =>
        block.destinations.forEach((to, j) => {
          if (from === to) return;
          const value = minutes[i][j];
          if (value === undefined) {
            failed++;
            return;
          }
          const key = pairKey(from, to, time);
          values.set(key, value);
          cachePair(key, value);
        })
      );
      if (failed) throw new Error(`Azure Maps matrix failed for ${failed} cells`);
    }),
    deadline
  );
  return { ok, values };
}

/**
 * Driving minutes between all points, via Azure Maps if it is configured, otherwise (or if the
 * service fails) estimated from the air-line distance. Points without a location (`null`) get
 * a flat `UNKNOWN_TRIP_MINUTES`. Never throws.
 */
export async function getTravelMatrix(
  points: (NikolausCoordinates | null)[],
  options: TravelOptions = {}
): Promise<TravelMatrix> {
  // Several bookings at one address share their row
  const unique = new Map<string, NikolausCoordinates>();
  for (const point of points) if (point) unique.set(pointKey(point), point);

  const departAt =
    options.departAt && Date.parse(options.departAt) > Date.now() ? options.departAt : undefined;
  const time = departAt ?? 'any';
  let source: TravelSource = 'estimate';
  let routes = new Map<string, number | null>();
  if (unique.size > 1 && isAzureMapsConfigured()) {
    const filled = await fillPairs(unique, departAt);
    if (filled.ok) {
      source = 'route';
      routes = filled.values;
    }
  }

  const minutes = points.map((from, i) =>
    points.map((to, j) => {
      if (i === j) return 0;
      if (!from || !to) return UNKNOWN_TRIP_MINUTES;
      const a = pointKey(from);
      const b = pointKey(to);
      const routed = a === b ? 0 : routes.get(pairKey(a, b, time));
      const base = typeof routed === 'number' ? routed : estimate(from, to);
      return Math.round((base + PARKING_MINUTES) * 10) / 10;
    })
  );

  return { minutes, source };
}

/** Azure Maps accepts at most 150 waypoints per route. */
const MAX_ROUTE_POINTS = 150;
const CACHE_MAX_ROUTES = 200;
const routeCache = new Map<string, { path: [number, number][]; expires: number }>();

/** The course of the route as `[lat, lon]` pairs, from the `RoutePath` feature. */
export function parseRoutePath(value: unknown): [number, number][] {
  const features = (value as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('Azure Maps returned no route');
  const route = features.find(
    (feature: unknown) =>
      (feature as { properties?: { type?: unknown } } | null)?.properties?.type === 'RoutePath'
  ) as { geometry?: { type?: unknown; coordinates?: unknown } } | undefined;
  const geometry = route?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    throw new Error('Azure Maps returned no route');
  }
  const lines =
    geometry.type === 'LineString' ? [geometry.coordinates] : (geometry.coordinates as unknown[]);
  const path = lines
    .flatMap((line) => (Array.isArray(line) ? (line as unknown[]) : []))
    .filter(
      (c): c is [number, number] =>
        Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
    )
    .map(([lon, lat]): [number, number] => [lat, lon]);
  if (path.length < 2) throw new Error('Azure Maps returned no route');
  return path;
}

/**
 * The course of a route along the roads as `[lat, lon]` pairs, via Azure Maps. Only for the
 * map, so it returns `null` instead of throwing when Azure Maps is not configured, there are
 * too many points or the service fails; the map then draws straight lines.
 */
export async function getRoutePath(
  points: NikolausCoordinates[]
): Promise<[number, number][] | null> {
  if (!isAzureMapsConfigured() || points.length < 2 || points.length > MAX_ROUTE_POINTS) {
    return null;
  }

  const key = points.map(pointKey).join(';');
  const cached = routeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.path;

  try {
    const body = await requestAzureMaps({
      method: 'POST',
      path: '/route/directions',
      apiVersion: CONFIG.azureMaps.routeApiVersion,
      body: {
        type: 'FeatureCollection',
        features: points.map((p, index) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { pointIndex: index, pointType: 'waypoint' },
        })),
        travelMode: 'driving',
        routeOutputOptions: ['routePath'],
      },
      timeoutMs: TIMEOUT_MS,
    });
    const path = parseRoutePath(body);
    if (routeCache.size >= CACHE_MAX_ROUTES) {
      const oldest = routeCache.keys().next().value;
      if (oldest !== undefined) routeCache.delete(oldest);
    }
    routeCache.set(key, { path, expires: Date.now() + CACHE_TTL_MS });
    return path;
  } catch (error: unknown) {
    console.warn('Azure Maps route failed, the map shows straight lines', error);
    return null;
  }
}
