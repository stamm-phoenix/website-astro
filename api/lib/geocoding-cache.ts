import { z } from 'zod';
import type { GeocodeResult } from './geocoding';
import { readRequestBudget } from './request-budget';
import type { RequestBudget } from './request-budget';

interface CachedLookup {
  key: string;
  expires: number;
  result: GeocodeResult;
}

/** Located addresses shared by all Function instances of an environment. */
export interface GeocodingCache {
  version: 2;
  entries: CachedLookup[];
}

/** Production, preview and every Function instance use this same state record. */
export const GEOCODING_STATE_KEY = 'geocoding:azure-maps';
/** Pacing and cache of the former Nominatim search; removed with the bookings. */
export const LEGACY_GEOCODING_STATE_KEY = 'geocoding:nominatim';
/** Requests to Azure Maps in the current UTC hour and day, shared by all instances. */
export const GEOCODING_BUDGET_KEY = 'geocoding:azure-maps:budget';

type GeocodingBudget = RequestBudget;

/** A damaged budget must not silently reset to zero, so it admits nothing until repaired. */
export function parseGeocodingBudget(value: unknown | undefined, now: number): GeocodingBudget {
  const budget = readRequestBudget(value, now);
  if (!budget) throw new Error('Invalid geocoding budget');
  return budget;
}

/**
 * Reserves one request to Azure Maps in the shared hourly and daily budget, atomically under
 * the row lock of `mutate`. False when the budget is used up or cannot be read: then no request
 * is sent. A reservation is never refunded.
 */
export async function reserveGeocodingRequest(
  mutate: (
    parse: (value: unknown | undefined) => GeocodingBudget,
    change: (budget: GeocodingBudget) => GeocodingBudget | undefined
  ) => Promise<GeocodingBudget | undefined>,
  hourly: number,
  daily: number,
  now = Date.now()
): Promise<boolean> {
  try {
    const reserved = await mutate(
      (value) => parseGeocodingBudget(value, now),
      (current) =>
        current.hourCount >= hourly || current.dayCount >= daily
          ? undefined
          : { ...current, hourCount: current.hourCount + 1, dayCount: current.dayCount + 1 }
    );
    return reserved !== undefined;
  } catch {
    return false;
  }
}

export interface GeocodingCacheDependencies {
  read: () => Promise<unknown | undefined>;
  mutate: (
    parse: (value: unknown | undefined) => GeocodingCache,
    change: (cache: GeocodingCache) => GeocodingCache | undefined
  ) => Promise<unknown>;
  now?: () => number;
  log?: (event: GeocodingEvent) => void;
}

export interface GeocodingEvent {
  event: 'cache_hit' | 'request_finish' | 'cache_failed';
  at: number;
  durationMs?: number;
  success?: boolean;
}

export interface GeocodingCacheLookup {
  lookup: (key: string, task: () => Promise<GeocodeResult>) => Promise<GeocodeResult>;
}

const CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 100;

const within = (limit: number) => z.number().min(-limit).max(limit);

/** A found address has a precision and a position on Earth; a failure must not be stored. */
const geocodeResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false), unavailable: z.undefined().optional() }),
  z.object({
    found: z.literal(true),
    precision: z.enum(['address', 'street', 'area']),
    lat: within(90),
    lon: within(180),
  }),
]);

const cachedLookupSchema = z.object({
  key: z.string(),
  expires: z.number(),
  result: geocodeResultSchema,
});

const storedCacheSchema = z.object({ version: z.literal(2), entries: z.array(z.unknown()) });

function isGeocodeResult(value: unknown): value is GeocodeResult {
  return geocodeResultSchema.safeParse(value).success;
}

function isCachedLookup(value: unknown): value is CachedLookup {
  return cachedLookupSchema.safeParse(value).success;
}

/** A damaged record only costs a few lookups again, so it starts over empty. */
export function parseGeocodingCache(value: unknown | undefined): GeocodingCache {
  const stored = storedCacheSchema.safeParse(value);
  if (!stored.success) return { version: 2, entries: [] };
  return {
    version: 2,
    entries: stored.data.entries.filter(isCachedLookup).slice(-MAX_CACHE_ENTRIES),
  };
}

/**
 * Answers repeated lookups of an address (the map while typing, then the booking) from a
 * shared 24-hour cache. Failures are not cached, and a failing cache never stops a lookup.
 */
export function createGeocodingCache(
  dependencies: GeocodingCacheDependencies
): GeocodingCacheLookup {
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? (() => undefined);
  const running = new Map<string, Promise<GeocodeResult>>();

  async function cached(key: string): Promise<GeocodeResult | undefined> {
    try {
      const at = now();
      return parseGeocodingCache(await dependencies.read()).entries.find(
        (entry) => entry.key === key && entry.expires > at
      )?.result;
    } catch {
      log({ event: 'cache_failed', at: now() });
      return undefined;
    }
  }

  async function store(key: string, result: GeocodeResult): Promise<void> {
    try {
      await dependencies.mutate(parseGeocodingCache, (current) => {
        const at = now();
        return {
          version: 2,
          entries: [
            ...current.entries
              .filter((entry) => entry.expires > at && entry.key !== key)
              .slice(-(MAX_CACHE_ENTRIES - 1)),
            { key, expires: at + CACHE_TTL_MS, result },
          ],
        };
      });
    } catch {
      log({ event: 'cache_failed', at: now() });
    }
  }

  async function lookup(key: string, task: () => Promise<GeocodeResult>): Promise<GeocodeResult> {
    const hit = await cached(key);
    if (hit) {
      log({ event: 'cache_hit', at: now() });
      return hit;
    }
    const started = now();
    let result: GeocodeResult;
    try {
      result = await task();
      if (!isGeocodeResult(result)) throw new Error('Invalid geocoding result');
    } catch {
      result = { found: false, unavailable: true };
    }
    const success = !result.unavailable;
    log({ event: 'request_finish', at: now(), durationMs: now() - started, success });
    if (success) await store(key, result);
    return result;
  }

  return {
    lookup(key, task) {
      // The same address twice at once (map and booking) needs only one request
      const existing = running.get(key);
      if (existing) return existing;
      const run = lookup(key, task).finally(() => running.delete(key));
      running.set(key, run);
      return run;
    },
  };
}
