import { pflegeHandler, ok, readJsonBody } from '../lib/pflege-api';
import { getCampflowEvents } from '../lib/campflow';
import { berlinDay } from '../lib/calendar-day';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { readQuelle } from '../lib/validation/zeitplan-quelle';
import {
  MIN_MODEL_MS,
  ZEITPLAN_BUDGET_MS,
  ZeitplanLimitError,
  isZeitplanConfigured,
  readZeitplan,
} from '../lib/kurzbeschreibung-zeitplan';
import { EVENT_ID_PATTERN } from './intern-abrechnung';

function invalid(message: string): ReturnType<typeof errorResponse> {
  return errorResponse(400, 'INVALID', message);
}

/**
 * POST: reads the Zeitplan of the Aktion from the file in the body (`bilder`: JPEGs as base64,
 * or `tabelle`: `{ name, data }` of an .xlsx or .csv) or from a description (`freitext`), and
 * answers with days and blocks to prefill the Kurzbeschreibung. Nothing is stored. `available` is false without a model.
 */
export const AbrechnungZeitplanEndpoint = pflegeHandler('abrechnung-zeitplan', async (request) => {
  const started = Date.now();
  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id) || id.length > 128) return invalid('Ungültige Aktion.');
  if (!isZeitplanConfigured()) return ok({ available: false, zeitplan: null });

  const quelle = readQuelle(await readJsonBody(request));
  if (typeof quelle === 'string') return invalid(quelle);

  const event = (await getCampflowEvents()).find((entry) => entry.id === id);
  if (!event) return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es nicht mehr.');
  // CampFlow sends plain dates and points in time; the page shows the day in Berlin
  const day = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : berlinDay(date);
  };

  // Loading the events from CampFlow counts against the time limit of Static Web Apps too
  const remaining = ZEITPLAN_BUDGET_MS - (Date.now() - started);
  if (remaining < MIN_MODEL_MS) {
    return errorResponse(
      503,
      'READ_UNAVAILABLE',
      'CampFlow hat gerade lange gebraucht. Es wurde nichts geändert. Versuche es gleich noch einmal.'
    );
  }

  try {
    const zeitplan = await readZeitplan(
      { title: event.title, start: day(event.start_date), end: day(event.end_date) },
      quelle,
      remaining
    );
    return ok({ available: true, zeitplan });
  } catch (error: unknown) {
    if (error instanceof ZeitplanLimitError) {
      return errorResponse(
        429,
        'READ_LIMIT',
        'Für heute wurden schon zu viele Zeitpläne ausgelesen. Trage den Zeitplan bitte selbst ein oder versuche es morgen noch einmal.'
      );
    }
    return errorResponse(
      502,
      'READ_UNAVAILABLE',
      'Der Zeitplan konnte gerade nicht ausgelesen werden. Es wurde nichts geändert. Versuche es gleich noch einmal oder trage ihn selbst ein.'
    );
  }
});
export const AbrechnungZeitplanHandler = withErrorHandling(AbrechnungZeitplanEndpoint);
