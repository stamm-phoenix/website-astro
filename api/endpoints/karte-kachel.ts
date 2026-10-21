import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getMapAttribution, getMapTile, isTileStyle, parseTileAddress } from '../lib/map-tiles';
import { withErrorHandling } from '../lib/response-utils';

/** Invalid tile addresses stay invalid; they are no Azure Maps content and may be kept by anyone. */
const INVALID_CACHE = 'public, max-age=86400';
/**
 * The area moves with the starting point of the teams, which the API reads every ten minutes;
 * an empty square outside it may only be kept that long.
 */
const OUTSIDE_CACHE = 'public, max-age=600';

/**
 * GET `/api/karte/<hell|dunkel>/<z>/<x>/<y>.png`: a map tile of the Nikolaus maps, public
 * because the booking form shows the map. Only the browser of the user may keep it (`private`),
 * as the terms of Azure Maps allow no shared cache. Tiles outside the area answer 404, so a map
 * that is moved far away shows empty squares.
 */
export async function GetKarteKachelEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const { style, z, x, y } = request.params;
  const address = parseTileAddress(style, z, x, y);
  if (!address) return { status: 404, headers: { 'Cache-Control': INVALID_CACHE } };
  const result = await getMapTile(address);
  if (result.status === 'ok') {
    return {
      status: 200,
      headers: {
        'Content-Type': result.tile.contentType,
        'Cache-Control': `private, max-age=${result.tile.maxAgeSeconds}`,
      },
      body: result.tile.body,
    };
  }
  if (result.status === 'outside') {
    return { status: 404, headers: { 'Cache-Control': OUTSIDE_CACHE } };
  }
  // Maps switched off or a passing failure: nothing may keep this answer
  return { status: result.status === 'off' ? 404 : 503, headers: { 'Cache-Control': 'no-store' } };
}

/**
 * GET `/api/karte-quelle/<hell|dunkel>/<z>`: the copyright notices of the tiles at a zoom
 * level, which the map must show (`{ copyrights: string[] }`, plain text).
 */
export async function GetKarteQuelleEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const { style, z } = request.params;
  const zoom = /^\d{1,2}$/.test(z ?? '') ? Number(z) : NaN;
  if (!isTileStyle(style) || !Number.isInteger(zoom)) {
    return { status: 404, headers: { 'Cache-Control': INVALID_CACHE } };
  }
  const copyrights = await getMapAttribution(style, zoom);
  return {
    status: 200,
    headers: { 'Cache-Control': copyrights.length ? 'private, max-age=3600' : 'no-store' },
    jsonBody: { copyrights },
  };
}

export const KarteKachel = withErrorHandling(GetKarteKachelEndpoint);
export const KarteQuelle = withErrorHandling(GetKarteQuelleEndpoint);
