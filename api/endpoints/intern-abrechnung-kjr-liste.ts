import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { kjrPersons } from '../lib/abrechnung';
import { CONFIG } from '../lib/config';
import { countNights } from '../lib/kjr-zuschuss';
import { buildKjrTeilnahmeliste, KjrListeError } from '../lib/kjr-teilnahmeliste';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { EVENT_ID_PATTERN, loadAktion } from './intern-abrechnung';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ORT_LENGTH = 200;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

let template: Buffer | undefined;

/** The KJR's empty template, deployed with the API (`api/assets`). */
export function kjrTemplate(): Buffer {
  template ??= readFileSync(join(__dirname, '..', '..', 'assets', 'kjr-teilnahmeliste.xlsx'));
  return template;
}

/** Characters Windows does not allow in file names. */
function fileName(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `KJR-Teilnahmeliste ${safe || 'Aktion'}.xlsx`;
}

/**
 * The KJR Rosenheim's Teilnahmeliste for the grant application, filled with the confirmed
 * registrations of a CampFlow event. `ort`, `plz`, `beginn` and `ende` (times) come from the
 * page because CampFlow does not have them.
 */
export async function GetInternAbrechnungKjrListeEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }
  const ort = request.query.get('ort')?.trim() ?? '';
  const plz = request.query.get('plz')?.trim() ?? '';
  const beginnZeit = request.query.get('beginn')?.trim() ?? '';
  const endeZeit = request.query.get('ende')?.trim() ?? '';
  if (ort.length > MAX_ORT_LENGTH) {
    return errorResponse(400, 'INVALID_ORT', 'Der Veranstaltungsort ist zu lang.');
  }
  if (plz && !/^\d{5}$/.test(plz)) {
    return errorResponse(400, 'INVALID_PLZ', 'Die Postleitzahl muss fünfstellig sein.');
  }
  if (
    (beginnZeit && !TIME_PATTERN.test(beginnZeit)) ||
    (endeZeit && !TIME_PATTERN.test(endeZeit))
  ) {
    return errorResponse(400, 'INVALID_TIME', 'Uhrzeiten bitte als HH:MM angeben.');
  }

  const loaded = await loadAktion(id);
  if ('response' in loaded) return loaded.response;
  const { event, persons } = loaded;

  let file: Buffer;
  try {
    file = buildKjrTeilnahmeliste(kjrTemplate(), {
      kopf: {
        antragsteller: CONFIG.abrechnung.antragsteller,
        titel: event.title,
        ort,
        plz,
        beginn: event.start_date,
        beginnZeit,
        ende: event.end_date ?? event.start_date,
        endeZeit,
      },
      persons: kjrPersons(persons, event.start_date),
      nights: countNights(event.start_date, event.end_date),
    });
  } catch (error: unknown) {
    if (error instanceof KjrListeError)
      return errorResponse(422, 'TOO_MANY_PERSONS', error.message);
    throw error;
  }

  return {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': encodeContentDisposition(fileName(event.title)),
      'Cache-Control': 'no-store',
    },
    body: new Uint8Array(file),
  };
}

export default withErrorHandling(GetInternAbrechnungKjrListeEndpoint);
