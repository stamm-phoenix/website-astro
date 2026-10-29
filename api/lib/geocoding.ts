import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { requestAzureMaps, isAzureMapsConfigured } from './azure-maps';
import { CONFIG } from './config';
import type { NikolausCoordinates } from './nikolaus-config';
import { getNikolausSettings } from './nikolaus-settings';
import {
  GEOCODING_BUDGET_KEY,
  GEOCODING_STATE_KEY,
  createGeocodingCache,
  reserveGeocodingRequest,
} from './geocoding-cache';
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

/** The fields of an Azure Maps geocoding result that are used here. */
interface GeocodingFeature {
  lat: number;
  lon: number;
  type: string;
  postalCode?: string;
  streetNumber?: string;
}

const TIMEOUT_MS = 5000;
/** Result types of Azure Maps that are a single building or a stretch of a street. */
const ADDRESS_TYPES = new Set(['Address']);
const STREET_TYPES = new Set(['RoadBlock', 'RoadIntersection']);

const cache = createGeocodingCache({
  read: async () => (await readNikolausState(GEOCODING_STATE_KEY))?.data,
  mutate: (parse, change) => mutateNikolausState(GEOCODING_STATE_KEY, parse, change),
  log: (event) => console.info(JSON.stringify({ scope: 'nikolaus_geocoding', ...event })),
});

/** Text that is there and not blank, trimmed. */
const optionalText = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined));

/** One result: a position on Earth, the type and, if known, postal code and house number. */
const featureSchema = z
  .object({
    geometry: z.object({
      // GeoJSON order, there may be an altitude after it
      coordinates: z.tuple(
        [z.number().min(-180).max(180), z.number().min(-90).max(90)],
        z.unknown()
      ),
    }),
    properties: z.object({
      type: z.string().catch(''),
      address: z
        .object({ postalCode: optionalText, streetNumber: optionalText })
        .catch({ postalCode: undefined, streetNumber: undefined }),
    }),
  })
  .transform(
    ({
      geometry: {
        coordinates: [lon, lat],
      },
      properties,
    }): GeocodingFeature => ({
      lat,
      lon,
      type: properties.type,
      postalCode: properties.address.postalCode,
      streetNumber: properties.address.streetNumber,
    })
  );

const geocodingResponseSchema = z.object({ features: z.array(z.unknown()) });

/** Reads the GeoJSON answer; results without valid coordinates are left out. */
export function parseGeocodingFeatures(value: unknown): GeocodingFeature[] {
  const response = geocodingResponseSchema.safeParse(value);
  if (!response.success) throw new Error('Invalid geocoding response');
  return response.data.features.flatMap((feature) => {
    const parsed = featureSchema.safeParse(feature);
    return parsed.success ? [parsed.data] : [];
  });
}

async function search(
  query: Record<string, string>,
  base: NikolausCoordinates
): Promise<GeocodingFeature[]> {
  const { geocodingHourlyLimit: hourly, geocodingDailyLimit: daily } = CONFIG.nikolaus;
  const admitted = await reserveGeocodingRequest(
    (parse, change) => mutateNikolausState(GEOCODING_BUDGET_KEY, parse, change),
    hourly,
    daily
  );
  if (!admitted) {
    console.warn(JSON.stringify({ scope: 'nikolaus_geocoding', event: 'limit', at: Date.now() }));
    throw new Error('Geocoding budget exhausted');
  }
  const body = await requestAzureMaps({
    method: 'GET',
    path: '/geocode',
    apiVersion: CONFIG.azureMaps.searchApiVersion,
    query: {
      ...query,
      countryRegion: 'DE',
      top: '5',
      // Prefer results around the starting point of the teams without excluding others
      coordinates: `${base.lon},${base.lat}`,
    },
    timeoutMs: TIMEOUT_MS,
  });
  return parseGeocodingFeatures(body);
}

/** Results outside the postal code are another place of the same name. */
function matchingPostalCode(
  results: GeocodingFeature[],
  postalCode: string
): GeocodingFeature | undefined {
  return results.find((result) => result.postalCode === postalCode);
}

function precisionOf(result: GeocodingFeature): GeoPrecision {
  if (ADDRESS_TYPES.has(result.type)) return result.streetNumber ? 'address' : 'street';
  return STREET_TYPES.has(result.type) ? 'street' : 'area';
}

function toResult(match: GeocodingFeature, precision: GeoPrecision): GeocodeResult {
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return { found: true, precision, lat: round(match.lat), lon: round(match.lon) };
}

async function lookup(street: string, postalCode: string, city: string): Promise<GeocodeResult> {
  const { base } = (await getNikolausSettings()).area;
  // 1. The full address; without the house number Azure Maps answers with the street
  const exact = matchingPostalCode(
    await search({ addressLine: street, postalCode, locality: city }, base),
    postalCode
  );
  if (exact) return toResult(exact, precisionOf(exact));

  // 2. Only the town, the map then shows roughly the area
  const area = matchingPostalCode(await search({ postalCode, locality: city }, base), postalCode);
  return area ? toResult(area, 'area') : { found: false };
}

/**
 * Locates an address via Azure Maps. Never throws: if the service is not configured or
 * unreachable, `unavailable` is set instead. Results are shared for 24 hours by all instances.
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
    if (!isAzureMapsConfigured()) throw new Error('Azure Maps is not configured');
    const normalized = [street, postalCode, city].map((part) =>
      part.trim().normalize('NFC').toLowerCase()
    );
    const key = createHmac('sha256', secret)
      .update(JSON.stringify([CONFIG.azureMaps.endpoint, ...normalized]))
      .digest('hex');
    return await cache.lookup(key, () => lookup(street.trim(), postalCode.trim(), city.trim()));
  } catch {
    console.info(
      JSON.stringify({ scope: 'nikolaus_geocoding', event: 'unavailable', at: Date.now() })
    );
    return { found: false, unavailable: true };
  }
}
