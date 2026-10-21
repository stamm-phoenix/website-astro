import { dailyLimit } from './azure-openai';
import { requestAzureMaps, requestAzureMapsImage } from './azure-maps';
import { CONFIG } from './config';
import type { NikolausCoordinates } from './nikolaus-config';
import { getNikolausSettings } from './nikolaus-settings';

/**
 * Map tiles of the Nikolaus maps (address map and Dispo), fetched from Azure Maps by the API,
 * so the browser never contacts a third party and no key reaches it (#408). Only tiles around
 * the starting point of the teams are served, and a daily limit per instance caps the costs.
 *
 * The terms of Azure Maps forbid caching tiles to serve them to several users, so the API keeps
 * none and lets only the browser of each user keep them, no longer than Azure Maps allows.
 */

export type TileStyle = 'hell' | 'dunkel';

/** Raster tilesets of the Azure Maps Render API per theme of the website. */
const TILESETS: Record<TileStyle, string> = {
  hell: 'microsoft.base.road',
  dunkel: 'microsoft.base.darkgrey',
};

export interface TileAddress {
  style: TileStyle;
  z: number;
  x: number;
  y: number;
}

export interface Tile {
  contentType: string;
  body: Buffer;
  /** How long the browser may keep the tile. */
  maxAgeSeconds: number;
}

export type TileResult =
  | { status: 'ok'; tile: Tile }
  /** Not a tile of the maps: outside the area, too deep or the maps are off. */
  | { status: 'outside' }
  /** Azure Maps failed or the daily limit is used up. */
  | { status: 'unavailable' };

const TIMEOUT_MS = 8000;
const SETTINGS_TTL_MS = 10 * 60_000;
/** The browser keeps a tile at most a day, even if Azure Maps allows longer. */
const MAX_TILE_AGE_SECONDS = 24 * 60 * 60;
/** The copyright notice changes rarely and its service allows only a few requests a second. */
const ATTRIBUTION_TTL_MS = 60 * 60_000;

const admit = dailyLimit(() => CONFIG.mapTiles.maxRequestsPerDay);
let area: { value: Promise<NikolausCoordinates | null>; expires: number } | undefined;
const attributions = new Map<string, { value: Promise<string[]>; expires: number }>();

/** Reads `<style>/<z>/<x>/<y>` (the `y` may end in `.png`); null if it is no valid tile. */
export function parseTileAddress(
  style: string | undefined,
  z: string | undefined,
  x: string | undefined,
  y: string | undefined
): TileAddress | null {
  if (!isTileStyle(style)) return null;
  const numbers = [z, x, y?.replace(/\.png$/, '')].map((part) =>
    part !== undefined && /^\d{1,7}$/.test(part) ? Number(part) : NaN
  );
  const [zoom, column, row] = numbers;
  if (numbers.some((n) => !Number.isInteger(n)) || zoom > CONFIG.mapTiles.maxZoom) return null;
  const size = 2 ** zoom;
  if (column >= size || row >= size) return null;
  return { style, z: zoom, x: column, y: row };
}

export function isTileStyle(value: string | undefined): value is TileStyle {
  return value === 'hell' || value === 'dunkel';
}

/** Latitude of the northern edge of tile row `y` at zoom `z` (Web Mercator). */
function tileLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function tileLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** The square of `radiusKm` around `center` as `[west, south, east, north]`. */
function areaBounds(center: NikolausCoordinates, radiusKm: number): number[] {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return [
    center.lon - lonDelta,
    center.lat - latDelta,
    center.lon + lonDelta,
    center.lat + latDelta,
  ];
}

/** Whether the tile touches the square of `radiusKm` around `center`. */
export function isTileInArea(
  tile: Pick<TileAddress, 'z' | 'x' | 'y'>,
  center: NikolausCoordinates,
  radiusKm: number
): boolean {
  const [west, south, east, north] = areaBounds(center, radiusKm);
  return (
    tileLat(tile.y + 1, tile.z) <= north &&
    tileLat(tile.y, tile.z) >= south &&
    tileLon(tile.x, tile.z) <= east &&
    tileLon(tile.x + 1, tile.z) >= west
  );
}

/**
 * The starting point of the teams while the Nikolausdienst shows maps (online booking or staff
 * modules on), read at most every ten minutes because every map loads dozens of tiles.
 */
async function mapArea(): Promise<NikolausCoordinates | null> {
  if (!area || area.expires <= Date.now()) {
    const value = getNikolausSettings().then(
      (settings) => (settings.publicActive || settings.staffActive ? settings.area.base : null),
      () => null
    );
    area = { value, expires: Date.now() + SETTINGS_TTL_MS };
    // Maps that are off or a failed read are checked again with the next request
    void value.then((base) => {
      if (base === null && area?.value === value) area = undefined;
    });
  }
  return area.value;
}

/** One map tile for the Nikolaus maps. Never throws. */
export async function getMapTile(address: TileAddress): Promise<TileResult> {
  const center = await mapArea();
  if (!center || !isTileInArea(address, center, CONFIG.mapTiles.areaRadiusKm)) {
    return { status: 'outside' };
  }
  if (!admit()) {
    console.warn(JSON.stringify({ scope: 'map_tiles', event: 'limit', at: Date.now() }));
    return { status: 'unavailable' };
  }
  try {
    const tile = await requestAzureMapsImage({
      method: 'GET',
      path: '/map/tile',
      apiVersion: CONFIG.azureMaps.renderApiVersion,
      query: {
        tilesetId: TILESETS[address.style],
        zoom: String(address.z),
        x: String(address.x),
        y: String(address.y),
        tileSize: '256',
        language: 'de-DE',
      },
      timeoutMs: TIMEOUT_MS,
    });
    return {
      status: 'ok',
      tile: { ...tile, maxAgeSeconds: Math.min(tile.maxAgeSeconds, MAX_TILE_AGE_SECONDS) },
    };
  } catch (error: unknown) {
    console.warn('Azure Maps tile failed', error);
    return { status: 'unavailable' };
  }
}

/** The text of the notices, without their links: `<a …>&copy;2026 TomTom</a>` → `©2026 TomTom`. */
export function parseAttribution(value: unknown): string[] {
  const copyrights = (value as { copyrights?: unknown } | null)?.copyrights;
  if (!Array.isArray(copyrights)) throw new Error('Azure Maps returned no attribution');
  return copyrights
    .filter((text): text is string => typeof text === 'string')
    .map((text) =>
      text
        .replace(/<[^>]*>/g, '')
        .replace(/&copy;/g, '©')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((text, index, all) => text !== '' && all.indexOf(text) === index);
}

/**
 * The copyright notices Azure Maps requires next to its tiles, for the whole area at one zoom
 * level; an empty list if it is unknown, the map then shows only „© Microsoft“.
 */
export async function getMapAttribution(style: TileStyle, z: number): Promise<string[]> {
  const center = await mapArea();
  if (!center || z > CONFIG.mapTiles.maxZoom) return [];
  const key = `${style}/${z}`;
  const cached = attributions.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = requestAzureMaps({
    method: 'GET',
    path: '/map/attribution',
    apiVersion: CONFIG.azureMaps.renderApiVersion,
    query: {
      tilesetId: TILESETS[style],
      zoom: String(z),
      bounds: areaBounds(center, CONFIG.mapTiles.areaRadiusKm)
        .map((n) => n.toFixed(5))
        .join(','),
    },
    timeoutMs: TIMEOUT_MS,
  }).then(parseAttribution);
  attributions.set(key, { value, expires: Date.now() + ATTRIBUTION_TTL_MS });
  try {
    return await value;
  } catch (error: unknown) {
    console.warn('Azure Maps attribution failed', error);
    if (attributions.get(key)?.value === value) attributions.delete(key);
    return [];
  }
}

/** For tests: forget the area and the notices. */
export function resetMapTiles(): void {
  area = undefined;
  attributions.clear();
}
