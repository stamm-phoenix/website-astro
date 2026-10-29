import {
  einkaufAendern,
  einkaufAnlegen,
  einkaufLoeschen,
  postenAbhaken,
  postenAufheben,
  regelSetzen,
  verschieben,
} from '../lib/essen-einkaeufe';
import {
  readHakenEtag,
  validateEinkauf,
  validateHaken,
  validateRegel,
  validateVerschieben,
} from '../lib/essen-einkaeufe-validation';
import { ladeAnsicht } from '../lib/essen-planung';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readEtag,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/nikolaus-api';

/**
 * Shopping trips of a Planung with the live mode (`docs/essensplanung.md`, Einkäufe), with the
 * token of a link like the other endpoints of a Planung. Changes answer with the whole view.
 */

/** POST `{ name, datum, geschaeftId, bisMahlzeitId }`: adds a trip. */
export const EssensplanungEinkaeufe = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await einkaufAnlegen(zugang, validateEinkauf(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, name, datum, geschaeftId, bisMahlzeitId, abgeschlossen }`. DELETE (If-Match: the
 * `einkaufStand`) with what was ticked off on it.
 */
export const EssensplanungEinkauf = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await einkaufLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await einkaufAendern(zugang, id, validateEinkauf(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * PUT `{ etag | null, planungZutatId, einheit, erhalten, ersatz }`: ticks off a thing on the trip
 * (`etag` of what was ticked off before, null the first time).
 */
export const EssensplanungEinkaufAbhaken = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await postenAbhaken(zugang, readId(request), validateHaken(body), readHakenEtag(body));
  return ok(await ladeAnsicht(zugang));
});

/** PUT `{ planungZutatId, art: 'ohne' | 'mit' | 'fest' | null, menge, einheit }`. */
export const EssensplanungEinkaufRegel = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await regelSetzen(zugang, readId(request), validateRegel(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ planungZutatId, nachEinkaufId }`: moves an ingredient to another trip. */
export const EssensplanungEinkaufVerschieben = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await verschieben(zugang, readId(request), validateVerschieben(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** DELETE (If-Match): takes back a thing ticked off. */
export const EssensplanungEinkaufPosten = planungHandler(async (request) => {
  if (request.method !== 'DELETE') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await postenAufheben(zugang, readId(request), readEtag(null, request));
  return ok(await ladeAnsicht(zugang));
});
