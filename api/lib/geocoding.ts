import { NIKOLAUS_CONFIG } from './nikolaus-config';

/** How exactly an address could be located. */
export type GeoPrecision = 'address' | 'street' | 'area';

export interface GeocodeResult {
  found: boolean;
  precision?: GeoPrecision;
  lat?: number;
  lon?: number;
  /** Set if the geocoding service could not be reached; nothing is known then. */
  unavailable?: boolean;
}

interface NominatimResult {
  lat: string;
  lon: string;
  address?: { postcode?: string; house_number?: string };
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy requires an identifying user agent with contact information
const USER_AGENT = 'StammPhoenixWebsite/1.0 (+https://stamm-phoenix.de; kontakt@stamm-phoenix.de)';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { result: GeocodeResult; expires: number }>();
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Runs requests one after another with at least MIN_INTERVAL_MS in between (usage policy). */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function search(query: string): Promise<NominatimResult[]> {
  const { base } = NIKOLAUS_CONFIG.area;
  // Prefer results around the base without excluding others (bounded=0)
  const viewbox = [base.lon - 0.3, base.lat + 0.2, base.lon + 0.3, base.lat - 0.2].join(',');
  const params = new URLSearchParams({
    q: query,
    countrycodes: 'de',
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    viewbox,
    bounded: '0',
  });

  return throttled(async () => {
    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Nominatim responded with ${response.status}`);
    }
    const body: unknown = await response.json();
    return Array.isArray(body) ? (body as NominatimResult[]) : [];
  });
}

/** Nominatim does not reliably filter by postal code, so results are checked here. */
function matchingPostalCode(
  results: NominatimResult[],
  postalCode: string
): NominatimResult | undefined {
  return results.find((result) =>
    (result.address?.postcode ?? '')
      .split(/[;,]/)
      .map((code) => code.trim())
      .includes(postalCode)
  );
}

function toResult(match: NominatimResult, precision: GeoPrecision): GeocodeResult {
  const round = (value: string): number => Math.round(Number(value) * 1e6) / 1e6;
  return { found: true, precision, lat: round(match.lat), lon: round(match.lon) };
}

/** Removes a trailing house number like "1", "12a" or "3-5" from a street. */
function stripHouseNumber(street: string): string {
  return street.replace(/\s+\d+\s*[a-zA-Z]?(\s*[-/]\s*\d+\s*[a-zA-Z]?)?$/, '').trim();
}

async function lookup(street: string, postalCode: string, city: string): Promise<GeocodeResult> {
  // 1. Full address
  const exact = matchingPostalCode(await search(`${street}, ${postalCode} ${city}`), postalCode);
  if (exact) return toResult(exact, exact.address?.house_number ? 'address' : 'street');

  // 2. Street without house number
  const streetOnly = stripHouseNumber(street);
  if (streetOnly && streetOnly !== street) {
    const road = matchingPostalCode(
      await search(`${streetOnly}, ${postalCode} ${city}`),
      postalCode
    );
    if (road) return toResult(road, 'street');
  }

  // 3. Only the town, the map then shows roughly the area
  const area = matchingPostalCode(await search(`${postalCode} ${city}`), postalCode);
  return area ? toResult(area, 'area') : { found: false };
}

/**
 * Locates an address via OpenStreetMap Nominatim. Never throws: if the service is
 * unreachable, `unavailable` is set instead. Results are cached per process.
 */
export async function geocodeAddress(
  street: string,
  postalCode: string,
  city: string
): Promise<GeocodeResult> {
  const key = [street, postalCode, city].map((part) => part.trim().toLowerCase()).join('|');
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  let result: GeocodeResult;
  try {
    result = await lookup(street.trim(), postalCode.trim(), city.trim());
  } catch {
    // Do not cache failures, the service may be reachable again soon
    return { found: false, unavailable: true };
  }

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}
