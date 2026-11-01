import type { HttpResponseInit } from '@azure/functions';
import {
  belegAendern,
  belegAnlegen,
  belegFotoLesen,
  belegFotoSetzen,
  belegLoeschen,
} from '../lib/essen-belege';
import type { BelegFotos } from '../lib/essen-belege';
import { belegPruefen } from '../lib/essen-belege-ki';
import {
  readBelegFotoArt,
  validateBeleg,
  validateBelegAenderung,
} from '../lib/essen-belege-validation';
import { KiNichtVerfuegbar } from '../lib/essen-ki';
import { ladeAnsicht } from '../lib/essen-planung';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readEtag,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { encodeContentDisposition, errorResponse } from '../lib/response-utils';
import { checkPhoto, isPhotos, readPhotos } from '../lib/validation/beleg-upload';
import { ValidationError } from '../lib/validation/errors';

/**
 * The receipts of a Planung (`docs/essensplanung.md`, Belege), with the token of a link like the
 * other endpoints of a Planung. Changes answer with the whole view. Photos and their checks are
 * read and limited like the Belege of the Leitendenbereich (`validation/beleg-upload.ts`).
 */

/** The photos of a JSON body, or null when it sends none; an unusable one is an error answer. */
function fotosVon(body: Record<string, unknown> | null): BelegFotos | null | HttpResponseInit {
  if (body?.photo === undefined || body.photo === null) {
    if (body?.pdf !== undefined && body.pdf !== null)
      throw new ValidationError({ photo: 'Bitte das PDF noch einmal auswählen.' });
    return null;
  }
  const fotos = readPhotos(body);
  return isPhotos(fotos) ? fotos : { ...fotos, headers: NO_STORE_HEADERS };
}

function istAntwort(value: BelegFotos | null | HttpResponseInit): value is HttpResponseInit {
  return value !== null && !('photo' in value);
}

/** POST `{ datum, betragCent, haendler, notiz, bezahltVonId | bezahltVonText, erstattet?, photo?, original?, pdf? }`. */
export const EssensplanungBelege = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const input = validateBeleg(body);
  const fotos = fotosVon(body);
  if (istAntwort(fotos)) return fotos;
  await belegAnlegen(zugang, input, fotos);
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, …changed fields }`; DELETE (If-Match) removes the receipt with its photo. */
export const EssensplanungBeleg = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await belegLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await belegAendern(zugang, id, validateBelegAenderung(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * GET `?art=vorschau|bild|original|datei`: a picture of the receipt, also for the read-only
 * link (`datei` is the PDF itself). PUT `{ etag, photo, original?, pdf? }` adds or replaces the
 * photo, DELETE (If-Match) removes it.
 */
export const EssensplanungBelegFoto = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'GET') {
    const art = readBelegFotoArt(request.query.get('art'));
    const datei = await belegFotoLesen(zugang, id, art);
    if (!datei) {
      return {
        ...errorResponse(404, 'NOT_FOUND', 'Zu diesem Beleg gibt es kein Foto mehr.'),
        headers: NO_STORE_HEADERS,
      };
    }
    return {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': datei.pdf ? 'application/pdf' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        ...(art === 'datei' ? { 'Content-Disposition': encodeContentDisposition(datei.name) } : {}),
      },
      body: new Uint8Array(datei.bytes),
    };
  }
  if (request.method === 'DELETE') {
    await belegFotoSetzen(zugang, id, null, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  const etag = readEtag(body, request);
  const fotos = fotosVon(body);
  if (istAntwort(fotos)) return fotos;
  if (!fotos) throw new ValidationError({ photo: 'Bitte ein Foto oder PDF des Belegs wählen.' });
  await belegFotoSetzen(zugang, id, fotos, etag);
  return ok(await ladeAnsicht(zugang));
});

/**
 * POST with a JPEG as body: the check of a new photo to prefill the form (`{ available, check }`)
 * or, with `?nur=drehung`, how to turn it upright (`{ available, rotation }`), like the Belege of
 * the Leitendenbereich. Nothing is stored.
 */
export const EssensplanungBelegPruefung = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const ungueltig = checkPhoto(bytes);
  if (ungueltig) return { ...ungueltig, headers: NO_STORE_HEADERS };
  try {
    return ok(await belegPruefen(zugang, bytes, request.query.get('nur') === 'drehung'));
  } catch (error: unknown) {
    if (!(error instanceof KiNichtVerfuegbar)) throw error;
    return {
      status: error.status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { 'Retry-After': String(error.retryAfterSeconds) }),
      },
      jsonBody: {
        error: 'KI_NICHT_VERFUEGBAR',
        code: 'KI_NICHT_VERFUEGBAR',
        message: error.message,
      },
    };
  }
});
