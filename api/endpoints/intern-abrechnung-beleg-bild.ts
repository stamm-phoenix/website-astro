import { app } from '@azure/functions';
import { getBelegBild, getBelegVorschau, playwrightErrorResponse } from '../lib/playwright-api';
import { errorResponse } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/**
 * Like the Playwright API: CampFlow's receipt numbers, e.g. `2026-94`, or the ID of a receipt
 * not booked yet (`rcp_…`).
 */
const RECEIPT_NUMBER_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;

/**
 * A page of a receipt from CampFlow as PNG, for the printable PDF of the Einzelnachweise.
 * `x-campflow-pages` tells how many pages the receipt has.
 */
const getInternAbrechnungBelegBild: StaffRequestHandler = async (request) => {
  const nummer = request.params.nummer ?? '';
  if (!RECEIPT_NUMBER_PATTERN.test(nummer)) {
    return errorResponse(400, 'INVALID_NUMBER', 'Ungültige Belegnummer.');
  }
  const page = Number(request.query.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 100) {
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
};

export const GetInternAbrechnungBelegBildEndpoint = staffHandler(
  'abrechnung',
  getInternAbrechnungBelegBild
);

/**
 * The small preview of a receipt from CampFlow, for the gallery of the Belege. It does not
 * change, so the browser may keep it.
 */
const getInternAbrechnungBelegVorschau: StaffRequestHandler = async (request) => {
  const nummer = request.params.nummer ?? '';
  if (!RECEIPT_NUMBER_PATTERN.test(nummer)) {
    return errorResponse(400, 'INVALID_NUMBER', 'Ungültige Belegnummer.');
  }
  try {
    return {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' },
      body: await getBelegVorschau(nummer),
    };
  } catch (error: unknown) {
    return playwrightErrorResponse(
      error,
      undefined,
      errorResponse(404, 'BELEG_NOT_FOUND', `Den Beleg ${nummer} gibt es in CampFlow nicht.`)
    );
  }
};

export const GetInternAbrechnungBelegVorschauEndpoint = staffHandler(
  'abrechnung',
  getInternAbrechnungBelegVorschau
);

export default GetInternAbrechnungBelegBildEndpoint;

app.http('internAbrechnungBelegBild', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/belege/{nummer}/bild',
  handler: GetInternAbrechnungBelegBildEndpoint,
});

app.http('internAbrechnungBelegVorschau', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/belege/{nummer}/vorschau',
  handler: GetInternAbrechnungBelegVorschauEndpoint,
});
