import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '@azure/functions';
import { getAktionArt } from '../lib/aktion-art';
import { CONFIG } from '../lib/config';
import { countNights } from '../lib/kjr-zuschuss';
import {
  buildKjrTeilnahmeliste,
  KjrListeError,
  KjrListeInputError,
  parseKjrListeRequest,
} from '../lib/kjr-teilnahmeliste';
import type { KjrListeRequest } from '../lib/kjr-teilnahmeliste';
import { encodeContentDisposition, errorResponse, readJsonBody } from '../lib/response-utils';
import { EVENT_ID_PATTERN, loadAktion } from './intern-abrechnung';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

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
const postInternAbrechnungKjrListe: StaffRequestHandler = async (request) => {
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
  const art = await getAktionArt(id);
  if (art.keineAktion) {
    return errorResponse(
      409,
      'OHNE_ZUSCHUSS',
      'Diese Aktion ist als „keine Aktion“ markiert (z. B. eine Bestellung), deshalb gibt es keine Teilnahmeliste für den KJR. Nimm die Markierung bei der Aktion zurück, wenn es doch eine Aktion ist.'
    );
  }
  if (!art.zuschussfaehig) {
    return errorResponse(
      409,
      'OHNE_ZUSCHUSS',
      'Für diese Aktion wird kein KJR-Zuschuss beantragt, deshalb gibt es keine Teilnahmeliste für den KJR. Schalte den KJR-Zuschuss in der Abrechnung wieder ein, wenn du ihn doch beantragen willst.'
    );
  }

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
};

export const PostInternAbrechnungKjrListeEndpoint = staffHandler(
  'abrechnung-kjr-liste',
  postInternAbrechnungKjrListe,
  { readOnly: true }
);

export default PostInternAbrechnungKjrListeEndpoint;

app.http('internAbrechnungKjrListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/abrechnung/{id}/kjr-liste',
  handler: PostInternAbrechnungKjrListeEndpoint,
});
