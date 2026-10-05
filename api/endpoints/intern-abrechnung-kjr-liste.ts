import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { CONFIG } from '../lib/config';
import { countNights } from '../lib/kjr-zuschuss';
import {
  buildKjrTeilnahmeliste,
  KjrListeError,
  KjrListeInputError,
  parseKjrListeRequest,
} from '../lib/kjr-teilnahmeliste';
import type { KjrListeRequest } from '../lib/kjr-teilnahmeliste';
import { readJsonBody } from '../lib/nikolaus-api';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { EVENT_ID_PATTERN, loadAktion } from './intern-abrechnung';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
 * The KJR Rosenheim's Teilnahmeliste for the grant application. The page sends the persons as
 * shown in the Abrechnung (registrations it excluded left out, persons it added included) and
 * the header fields CampFlow does not have; title and dates come from the CampFlow event.
 */
export async function PostInternAbrechnungKjrListeEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Ungültige Aktions-ID.');
  }
  let input: KjrListeRequest;
  try {
    input = parseKjrListeRequest(await readJsonBody(request));
  } catch (error: unknown) {
    if (error instanceof KjrListeInputError) {
      return errorResponse(400, 'INVALID_INPUT', error.message);
    }
    throw error;
  }

  const loaded = await loadAktion(id);
  if ('response' in loaded) return loaded.response;
  const { event } = loaded;

  let file: Buffer;
  try {
    file = buildKjrTeilnahmeliste(kjrTemplate(), {
      kopf: {
        antragsteller: CONFIG.abrechnung.antragsteller,
        titel: event.title,
        ort: input.ort,
        plz: input.plz,
        beginn: event.start_date,
        beginnZeit: input.beginnZeit,
        ende: event.end_date ?? event.start_date,
        endeZeit: input.endeZeit,
      },
      persons: input.persons,
      nights: countNights(event.start_date, event.end_date),
    });
  } catch (error: unknown) {
    if (error instanceof KjrListeError) {
      return errorResponse(422, 'TOO_MANY_PERSONS', error.message);
    }
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

export default withErrorHandling(PostInternAbrechnungKjrListeEndpoint);
