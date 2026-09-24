import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { NIKOLAUS_CONFIG } from '../lib/nikolaus-config';
import { NIKOLAUS_MAX_LENGTH, isValidNikolausPostalCode } from '../lib/nikolaus-validation';
import { geocodeAddress } from '../lib/geocoding';
import { readJsonBody } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Locates an address for the map in the booking form via OpenStreetMap. */
export async function GeocodeNikolausAddressEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  if (!NIKOLAUS_CONFIG.active) {
    return errorResponse(404, 'INACTIVE', 'Der Nikolausdienst ist derzeit nicht aktiv.');
  }

  const body = await readJsonBody(request);
  const street = readText(body?.street, NIKOLAUS_MAX_LENGTH.street);
  const city = readText(body?.city, NIKOLAUS_MAX_LENGTH.city);
  if (!street || !city || !isValidNikolausPostalCode(body?.postalCode)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Bitte geben Sie eine vollständige Adresse an.');
  }

  const result = await geocodeAddress(street, body.postalCode.trim(), city);
  return {
    status: 200,
    // Addresses rarely move; let the browser reuse answers while typing back and forth
    headers: { 'Cache-Control': 'private, max-age=3600' },
    jsonBody: result,
  };
}

export default withErrorHandling(GeocodeNikolausAddressEndpoint);
