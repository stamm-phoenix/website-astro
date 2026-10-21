import type { GeocodeResult } from './geocoding';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGeocodeResult(value: unknown): value is GeocodeResult {
  if (!isRecord(value) || typeof value.found !== 'boolean') return false;
  if (!value.found) return value.unavailable === undefined;
  return (
    ['address', 'street', 'area'].includes(String(value.precision)) &&
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    Math.abs(value.lat) <= 90 &&
    typeof value.lon === 'number' &&
    Number.isFinite(value.lon) &&
    Math.abs(value.lon) <= 180
  );
}

function isCachedLookup(value: unknown): value is CachedLookup {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.expires === 'number' &&
    Number.isFinite(value.expires) &&
    isGeocodeResult(value.result)
  );
}

/** A damaged record only costs a few lookups again, so it starts over empty. */
export function parseGeocodingCache(value: unknown | undefined): GeocodingCache {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.entries)) {
    return { version: 2, entries: [] };
  }
  return { version: 2, entries: value.entries.filter(isCachedLookup).slice(-MAX_CACHE_ENTRIES) };
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
