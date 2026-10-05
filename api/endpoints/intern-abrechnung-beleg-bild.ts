import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getBelegBild, playwrightErrorResponse } from '../lib/playwright-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';

/** Like the Playwright API: CampFlow's receipt numbers, e.g. `2026-94`. */
const RECEIPT_NUMBER_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;
const MAX_PAGE = 100;

/**
 * A page of a receipt from CampFlow as PNG, for the printable PDF of the Einzelnachweise.
 * `x-campflow-pages` tells how many pages the receipt has.
 */
export async function GetInternAbrechnungBelegBildEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const nummer = request.params.nummer ?? '';
  if (!RECEIPT_NUMBER_PATTERN.test(nummer)) {
    return errorResponse(400, 'INVALID_NUMBER', 'Ungültige Belegnummer.');
  }
  const page = Number(request.query.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return errorResponse(400, 'INVALID_PAGE', 'Ungültige Seite.');
  }

  try {
    const bild = await getBelegBild(nummer, page);
    return {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
        'x-campflow-pages': String(bild.pages),
      },
      body: bild.png,
    };
  } catch (error: unknown) {
    return playwrightErrorResponse(
      error,
      undefined,
      errorResponse(404, 'BELEG_NOT_FOUND', `Den Beleg ${nummer} gibt es in CampFlow nicht.`)
    );
  }
}

export default withErrorHandling(GetInternAbrechnungBelegBildEndpoint);
