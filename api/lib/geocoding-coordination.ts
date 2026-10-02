import { randomUUID } from 'node:crypto';
import type { GeocodeResult } from './geocoding';

interface CachedLookup {
  key: string;
  expires: number;
  result: GeocodeResult;
}

export interface GeocodingState {
  version: 1;
  nextRequestAt: number;
  lease?: { owner: string; key: string; expires: number; startedAt?: number };
  cache: CachedLookup[];
}

export interface GeocodingCoordinationDependencies {
  read: () => Promise<unknown | undefined>;
  mutate: (
    parse: (value: unknown | undefined) => GeocodingState,
    change: (state: GeocodingState) => GeocodingState | undefined
  ) => Promise<GeocodingState | undefined>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (event: GeocodingEvent) => void;
}

export interface GeocodingEvent {
  event: 'cache_hit' | 'request_start' | 'request_finish' | 'unavailable';
  at: number;
  durationMs?: number;
  success?: boolean;
}

export interface GeocodingCoordinator {
  lookup: (
    key: string,
    task: (request: <T>(task: () => Promise<T>) => Promise<T>) => Promise<GeocodeResult>
  ) => Promise<GeocodeResult>;
}

// Provider calls cannot be fenced after an owner resumes from a long process pause.
// Reservations therefore never expire; recovery requires proving the old process stopped.
// Keep the legacy field at this sentinel so old deployments cannot reclaim new reservations.
const RESERVATION_EXPIRY = Number.MAX_SAFE_INTEGER;
const MIN_INTERVAL_MS = 1_100;
const WAIT_BUDGET_MS = 30_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const FAILURE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_LOCAL_LOOKUPS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isGeocodeResult(value: unknown): value is GeocodeResult {
  if (!isRecord(value) || typeof value.found !== 'boolean') return false;
  if (!value.found) return value.unavailable === undefined || value.unavailable === true;
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

/** A damaged coordination record must never silently reset a live lock or rate limit. */
export function parseGeocodingState(value: unknown | undefined): GeocodingState {
  if (value === undefined) return { version: 1, nextRequestAt: 0, cache: [] };
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isTimestamp(value.nextRequestAt) ||
    !Array.isArray(value.cache) ||
    value.cache.length > MAX_CACHE_ENTRIES
  ) {
    throw new Error('Invalid geocoding coordination state');
  }
  const cache: CachedLookup[] = value.cache.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.key !== 'string' ||
      !isTimestamp(entry.expires) ||
      !isGeocodeResult(entry.result)
    )
      throw new Error('Invalid geocoding cache');
    return { key: entry.key, expires: entry.expires, result: entry.result };
  });
  let lease: GeocodingState['lease'];
  if (value.lease !== undefined) {
    if (
      !isRecord(value.lease) ||
      typeof value.lease.owner !== 'string' ||
      typeof value.lease.key !== 'string' ||
      !isTimestamp(value.lease.expires)
    ) {
      throw new Error('Invalid geocoding lease');
    }
    if (value.lease.startedAt !== undefined && !isTimestamp(value.lease.startedAt))
      throw new Error('Invalid geocoding reservation timestamp');
    lease = {
      owner: value.lease.owner,
      key: value.lease.key,
      expires: value.lease.expires,
      ...(value.lease.startedAt !== undefined ? { startedAt: value.lease.startedAt } : {}),
    };
  }
  return { version: 1, nextRequestAt: value.nextRequestAt, cache, ...(lease ? { lease } : {}) };
}

/** Coordinates independent workers through a shared CAS record, including completed results. */
export function createGeocodingCoordinator(
  dependencies: GeocodingCoordinationDependencies
): GeocodingCoordinator {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = dependencies.log ?? (() => undefined);
  const local = new Map<string, Promise<GeocodeResult>>();

  async function coordinate(
    key: string,
    task: (request: <T>(task: () => Promise<T>) => Promise<T>) => Promise<GeocodeResult>
  ): Promise<GeocodeResult> {
    const owner = randomUUID();
    const deadline = now() + WAIT_BUDGET_MS;
    let leaseAcquired = false;
    let providerCallStarted = false;
    try {
      while (true) {
        const state = parseGeocodingState(await dependencies.read());
        const cached = state.cache.find((entry) => entry.key === key && entry.expires > now());
        if (cached) {
          log({ event: 'cache_hit', at: now() });
          return cached.result;
        }
        if (now() >= deadline) throw new Error('Geocoding wait budget exceeded');
        const acquired = await dependencies.mutate(parseGeocodingState, (current) => {
          const at = now();
          if (current.cache.some((entry) => entry.key === key && entry.expires > at)) return;
          // Even an expired legacy reservation may belong to a paused process.
          if (current.lease) return;
          return {
            ...current,
            cache: current.cache.filter((entry) => entry.expires > at),
            lease: { owner, key, expires: RESERVATION_EXPIRY, startedAt: at },
          };
        });
        if (acquired?.lease?.owner === owner) {
          leaseAcquired = true;
          break;
        }
        await sleep(300);
      }

      async function request<T>(send: () => Promise<T>): Promise<T> {
        // Every acquired worker waits a complete local interval before sending. This also
        // preserves the pause when two Function clocks differ slightly.
        await sleep(MIN_INTERVAL_MS);
        while (true) {
          const renewed = await dependencies.mutate(parseGeocodingState, (current) => {
            if (current.lease?.owner !== owner) return;
            return current;
          });
          if (renewed?.lease?.owner !== owner) {
            throw new Error('Geocoding lease lost');
          }
          const wait = renewed.nextRequestAt - now();
          if (wait <= 0) break;
          await sleep(Math.min(wait, 1_100));
        }
        const started = now();
        log({ event: 'request_start', at: started });
        let success = false;
        let result: T | undefined;
        let failure: unknown;
        try {
          providerCallStarted = true;
          result = await send();
          success = true;
        } catch (error: unknown) {
          failure = error;
        }
        log({ event: 'request_finish', at: now(), durationMs: now() - started, success });
        // Reserve the pause after completion, avoiding reliance on start timestamps alone.
        const saved = await dependencies.mutate(parseGeocodingState, (current) => {
          if (current.lease?.owner !== owner) return;
          return {
            ...current,
            nextRequestAt: now() + MIN_INTERVAL_MS,
          };
        });
        if (saved?.lease?.owner !== owner) throw new Error('Geocoding pacing could not be saved');
        if (!success) throw failure;
        return result as T;
      }

      let result: GeocodeResult;
      try {
        result = await task(request);
        if (!isGeocodeResult(result)) throw new Error('Invalid geocoding result');
      } catch {
        result = { found: false, unavailable: true };
      }
      const completed = await dependencies.mutate(parseGeocodingState, (current) => {
        if (current.lease?.owner !== owner) return;
        const at = now();
        return {
          version: 1,
          nextRequestAt: Math.max(current.nextRequestAt, at + MIN_INTERVAL_MS),
          cache: [
            ...current.cache
              .filter((entry) => entry.expires > at && entry.key !== key)
              .slice(-(MAX_CACHE_ENTRIES - 1)),
            { key, expires: at + (result.unavailable ? FAILURE_TTL_MS : CACHE_TTL_MS), result },
          ],
        };
      });
      if (!completed?.cache.some((entry) => entry.key === key)) {
        throw new Error('Geocoding completion could not be saved');
      }
      return result;
    } catch {
      if (leaseAcquired && !providerCallStarted) {
        try {
          await dependencies.mutate(parseGeocodingState, (current) => {
            if (current.lease?.owner !== owner) return;
            return { version: 1, nextRequestAt: current.nextRequestAt, cache: current.cache };
          });
        } catch {
          // Keep the durable reservation if its ownership cannot be checked safely.
        }
      }
      log({ event: 'unavailable', at: now() });
      return { found: false, unavailable: true };
    }
  }

  return {
    lookup(key, task) {
      const existing = local.get(key);
      if (existing) return existing;
      if (local.size >= MAX_LOCAL_LOOKUPS) {
        log({ event: 'unavailable', at: now() });
        return Promise.resolve({ found: false, unavailable: true });
      }
      const run = coordinate(key, task).finally(() => local.delete(key));
      local.set(key, run);
      return run;
    },
  };
}
