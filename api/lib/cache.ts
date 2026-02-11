interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp in milliseconds
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * A generic function to fetch data and cache its result.
 * @param cacheKey The key to use for caching this data.
 * @param fetcher The async function that fetches the data.
 * @param ttlSeconds The time-to-live for the cache entry in seconds. Defaults to 300 seconds (5 minutes).
 * @returns A Promise resolving to the fetched (or cached) data.
 */
export async function cachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  const cached = getFromCache<T>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const result = await fetcher();
  setInCache(cacheKey, result, ttlSeconds);
  return result;
}

function getFromCache<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry) {
    if (entry.expiresAt > Date.now()) {
      return entry.value;
    } else {
      cache.delete(key);
    }
  }
  return undefined;
}

function setInCache<T>(key: string, value: T, ttlSeconds: number): void {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  cache.set(key, { value, expiresAt });
}

// Optional: for debugging or explicit clearing
export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
