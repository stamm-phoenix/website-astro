import type { NikolausCoordinates } from './nikolaus-config';
import { distanceKm } from './nikolaus-config';

/** Where the driving times come from. */
export type TravelSource = 'route' | 'estimate';

export interface TravelMatrix {
  /** Driving minutes `minutes[from][to]` between the given points. */
  minutes: number[][];
  source: TravelSource;
}

const ORS_URL = 'https://api.openrouteservice.org/v2/matrix/driving-car';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 50;

/** Time to park and walk to the door, added to every trip. */
const PARKING_MINUTES = 2;
/** Estimate without a route: air-line distance × detour factor at an average speed. */
const DETOUR_FACTOR = 1.4;
const AVERAGE_KMH = 35;
/** Assumed trip to or from a point whose location is unknown. */
export const UNKNOWN_TRIP_MINUTES = 10;

const cache = new Map<string, { matrix: TravelMatrix; expires: number }>();

function estimate(a: NikolausCoordinates, b: NikolausCoordinates): number {
  return (distanceKm(a, b) * DETOUR_FACTOR * 60) / AVERAGE_KMH;
}

async function fetchRouteMatrix(
  points: NikolausCoordinates[],
  apiKey: string
): Promise<number[][]> {
  const response = await fetch(ORS_URL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: points.map((p) => [p.lon, p.lat]),
      metrics: ['duration'],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenRouteService responded with ${response.status}`);
  }
  const body = (await response.json()) as { durations?: unknown };
  const durations = body.durations;
  if (!Array.isArray(durations) || durations.length !== points.length) {
    throw new Error('OpenRouteService returned no matrix');
  }
  // Seconds → minutes; unroutable pairs (null) fall back to the estimate
  return durations.map((row: unknown, i) =>
    points.map((_, j) => {
      const value = Array.isArray(row) ? row[j] : null;
      return typeof value === 'number' ? value / 60 : estimate(points[i], points[j]);
    })
  );
}

/**
 * Driving minutes between all points, via OpenRouteService if `OPENROUTESERVICE_API_KEY` is
 * set, otherwise (or if the service fails) estimated from the air-line distance. Points
 * without a location (`null`) get a flat `UNKNOWN_TRIP_MINUTES`. Never throws.
 */
export async function getTravelMatrix(
  points: (NikolausCoordinates | null)[]
): Promise<TravelMatrix> {
  const known = points
    .map((point, index) => ({ point, index }))
    .filter((entry): entry is { point: NikolausCoordinates; index: number } => !!entry.point);

  let knownMinutes: number[][] | null = null;
  let source: TravelSource = 'estimate';
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;

  if (apiKey && known.length > 1) {
    const key = known.map(({ point }) => `${point.lat},${point.lon}`).join(';');
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      knownMinutes = cached.matrix.minutes;
      source = cached.matrix.source;
    } else {
      try {
        knownMinutes = await fetchRouteMatrix(
          known.map(({ point }) => point),
          apiKey
        );
        source = 'route';
        if (cache.size >= CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, {
          matrix: { minutes: knownMinutes, source },
          expires: Date.now() + CACHE_TTL_MS,
        });
      } catch (error: unknown) {
        console.warn('OpenRouteService matrix failed, using air-line estimate', error);
      }
    }
  }

  const position = new Map(known.map(({ index }, k) => [index, k]));
  const minutes = points.map((from, i) =>
    points.map((to, j) => {
      if (i === j) return 0;
      if (!from || !to) return UNKNOWN_TRIP_MINUTES;
      const fi = position.get(i);
      const tj = position.get(j);
      const base =
        knownMinutes && fi !== undefined && tj !== undefined
          ? knownMinutes[fi][tj]
          : estimate(from, to);
      return Math.round((base + PARKING_MINUTES) * 10) / 10;
    })
  );

  return { minutes, source };
}
