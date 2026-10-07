import { createHmac } from 'node:crypto';
import { CONFIG } from './config';
import type { NikolausCoordinates } from './nikolaus-config';
import { getNikolausSettings } from './nikolaus-settings';
import { createGeocodingCoordinator } from './geocoding-coordination';
import { mutateNikolausState, readNikolausState } from './nikolaus-state';

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

// Nominatim's usage policy requires an identifying user agent with contact information
const USER_AGENT = 'StammPhoenixWebsite/1.0 (+https://stamm-phoenix.de; kontakt@stamm-phoenix.de)';
const TIMEOUT_MS = 5000;
// Production, preview and every Function instance must use this same state record.
const STATE_KEY = 'geocoding:nominatim';
const coordinator = createGeocodingCoordinator({
  read: async () => (await readNikolausState(STATE_KEY))?.data,
  mutate: (parse, change) => mutateNikolausState(STATE_KEY, parse, change),
  log: (event) => console.info(JSON.stringify({ scope: 'nikolaus_geocoding', ...event })),
});

type CoordinatedRequest = <T>(task: () => Promise<T>) => Promise<T>;

function geocodingUrl(): string {
  const url = new URL(CONFIG.nikolaus.geocodingUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error('Invalid geocoding provider configuration');
  }
  return url.toString();
}

function parseSearchResults(value: unknown): NominatimResult[] {
  if (!Array.isArray(value)) throw new Error('Invalid geocoding response');
  return value.filter((item: unknown): item is NominatimResult => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Partial<NominatimResult>;
    return (
      typeof candidate.lat === 'string' &&
      typeof candidate.lon === 'string' &&
      Number.isFinite(Number(candidate.lat)) &&
      Math.abs(Number(candidate.lat)) <= 90 &&
      Number.isFinite(Number(candidate.lon)) &&
      Math.abs(Number(candidate.lon)) <= 180 &&
      (candidate.address === undefined ||
        (typeof candidate.address === 'object' &&
          candidate.address !== null &&
          (candidate.address.postcode === undefined ||
            typeof candidate.address.postcode === 'string') &&
          (candidate.address.house_number === undefined ||
            typeof candidate.address.house_number === 'string')))
    );
  });
}

async function search(
  query: string,
  url: string,
  base: NikolausCoordinates,
  request: CoordinatedRequest
): Promise<NominatimResult[]> {
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

  return request(async () => {
    const response = await fetch(`${url}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Nominatim responded with ${response.status}`);
    }
    const body: unknown = await response.json();
    return parseSearchResults(body);
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

async function lookup(
  street: string,
  postalCode: string,
  city: string,
  url: string,
  request: CoordinatedRequest
): Promise<GeocodeResult> {
  // Results around the starting point of the teams are preferred
  const { base } = (await getNikolausSettings()).area;
  // 1. Full address
  const exact = matchingPostalCode(
    await search(`${street}, ${postalCode} ${city}`, url, base, request),
    postalCode
  );
  if (exact) return toResult(exact, exact.address?.house_number ? 'address' : 'street');

  // 2. Street without house number
  const streetOnly = stripHouseNumber(street);
  if (streetOnly && streetOnly !== street) {
    const road = matchingPostalCode(
      await search(`${streetOnly}, ${postalCode} ${city}`, url, base, request),
      postalCode
    );
    if (road) return toResult(road, 'street');
  }

  // 3. Only the town, the map then shows roughly the area
  const area = matchingPostalCode(
    await search(`${postalCode} ${city}`, url, base, request),
    postalCode
  );
  return area ? toResult(area, 'area') : { found: false };
}

/**
 * Locates an address via OpenStreetMap Nominatim. Never throws: if the service is
 * unreachable, `unavailable` is set instead. Workers share pacing, durable reservations and a
 * 24-hour cache. A crashed reservation owner requires confirmed operator recovery.
 */
export async function geocodeAddress(
  street: string,
  postalCode: string,
  city: string
): Promise<GeocodeResult> {
  try {
    const secret = process.env.NIKOLAUS_STATE_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('Missing shared geocoding configuration');
    }
    const url = geocodingUrl();
    const normalized = [street, postalCode, city].map((part) =>
      part.trim().normalize('NFC').toLowerCase()
    );
    const key = createHmac('sha256', secret)
      .update(JSON.stringify([url, ...normalized]))
      .digest('hex');
    return await coordinator.lookup(key, (request) =>
      lookup(street.trim(), postalCode.trim(), city.trim(), url, request)
    );
  } catch {
    console.info(
      JSON.stringify({ scope: 'nikolaus_geocoding', event: 'unavailable', at: Date.now() })
    );
    return { found: false, unavailable: true };
  }
}
