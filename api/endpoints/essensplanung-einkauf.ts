import type { HttpRequest } from '@azure/functions';
import type { PostenArt } from '../lib/essen-einkauf-model';
import {
  geschaeftAendern,
  geschaeftAnlegen,
  geschaeftLoeschen,
  postenAendern,
  postenAnlegen,
  postenLoeschen,
  zutatGeschaeftSetzen,
} from '../lib/essen-einkauf';
import {
  validateGeschaeft,
  validatePosten,
  validateZutatGeschaeft,
} from '../lib/essen-einkauf-validation';
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
 * Shops, stock and extra needs of a Planung (`docs/essensplanung.md`, Einkaufsliste), with the
 * token of a link like the other endpoints of a Planung. Changes answer with the whole view.
 */

/** POST `{ name }`: adds a shop. */
export const EssensplanungGeschaefte = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  await geschaeftAnlegen(zugang, validateGeschaeft(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, name }`: renames a shop. DELETE (If-Match): its ingredients keep no shop. */
export const EssensplanungGeschaeft = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await geschaeftLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await geschaeftAendern(zugang, id, validateGeschaeft(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** PUT `{ geschaeftId, etag }` (null: none; the version of the ingredient): where it is bought. */
export const EssensplanungZutatGeschaeft = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const geschaeftId = validateZutatGeschaeft(body);
  await zutatGeschaeftSetzen(zugang, readId(request), geschaeftId, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ zutatId | planungZutatId, menge, einheit, hinweis }` to stock or extra needs. */
function postenListe(art: PostenArt) {
  return planungHandler(async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const zugang = await zugangVon(request);
    await postenAnlegen(zugang, art, validatePosten(await readJsonBody(request)));
    return ok(await ladeAnsicht(zugang), 201);
  });
}

/** PATCH `{ etag, …the whole entry }` or DELETE (If-Match) an entry of stock or extra needs. */
function posten(art: PostenArt) {
  return planungHandler(async (request: HttpRequest) => {
    const zugang = await zugangVon(request);
    const id = readId(request);
    if (request.method === 'DELETE') {
      await postenLoeschen(zugang, art, id, readEtag(null, request));
      return ok(await ladeAnsicht(zugang));
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    await postenAendern(zugang, art, id, validatePosten(body), readEtag(body, request));
    return ok(await ladeAnsicht(zugang));
  });
}

export const EssensplanungBestandListe = postenListe('bestand');
export const EssensplanungBestand = posten('bestand');
export const EssensplanungZusatzbedarfListe = postenListe('zusatzbedarf');
export const EssensplanungZusatzbedarf = posten('zusatzbedarf');
