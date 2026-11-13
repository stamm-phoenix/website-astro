import { app } from '@azure/functions';
import {
  einkaufAendern,
  einkaufAnlegen,
  einkaufLoeschen,
  postenAbhaken,
  postenAufheben,
  regelSetzen,
  verschieben,
  zurueckholen,
} from '../lib/essen-einkaeufe';
import {
  readHakenEtag,
  validateEinkauf,
  validateHaken,
  validateRegel,
  validateVerschieben,
  validateZurueckholen,
} from '../lib/essen-einkaeufe-validation';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { ok, planungHandler, readEtag, readId, zugangVon } from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/response-utils';

/**
 * Shopping trips of a Planung with the live mode (`docs/essensplanung.md`, Einkäufe), with the
 * token of a link like the other endpoints of a Planung. Changes answer with the whole view.
 */

/** POST `{ name, datum, geschaeftId, bisMahlzeitId }`: adds a trip. */
export const EssensplanungEinkaeufe = planungHandler(async (request) => {
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
  const body = await readJsonBody(request);
  await einkaufAendern(zugang, id, validateEinkauf(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * PUT `{ etag | null, planungZutatId, einheit, erhalten, ersatz }`: ticks off a thing on the trip
 * (`etag` of what was ticked off before, null the first time).
 */
export const EssensplanungEinkaufAbhaken = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await postenAbhaken(zugang, readId(request), validateHaken(body), readHakenEtag(body));
  return ok(await ladeAnsicht(zugang));
});

/** PUT `{ planungZutatId, art: 'ohne' | 'mit' | 'fest' | null, menge, einheit }`. */
export const EssensplanungEinkaufRegel = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await regelSetzen(zugang, readId(request), validateRegel(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ planungZutatId, nachEinkaufId }`: moves an ingredient to another trip. */
export const EssensplanungEinkaufVerschieben = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await verschieben(zugang, readId(request), validateVerschieben(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ planungZutatId }`: takes back „not on this trip“ and the „mit“ of the other trip. */
export const EssensplanungEinkaufZurueckholen = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await zurueckholen(zugang, readId(request), validateZurueckholen(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** DELETE (If-Match): takes back a thing ticked off. */
export const EssensplanungEinkaufPosten = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await postenAufheben(zugang, readId(request), readEtag(null, request));
  return ok(await ladeAnsicht(zugang));
});

app.http('essensplanungEinkaeufe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe',
  handler: EssensplanungEinkaeufe,
});

app.http('essensplanungEinkauf', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}',
  handler: EssensplanungEinkauf,
});

app.http('essensplanungEinkaufAbhaken', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/posten',
  handler: EssensplanungEinkaufAbhaken,
});

app.http('essensplanungEinkaufRegel', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/regeln',
  handler: EssensplanungEinkaufRegel,
});

app.http('essensplanungEinkaufVerschieben', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/verschieben',
  handler: EssensplanungEinkaufVerschieben,
});

app.http('essensplanungEinkaufZurueckholen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkaeufe/{id}/zurueckholen',
  handler: EssensplanungEinkaufZurueckholen,
});

app.http('essensplanungEinkaufPosten', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einkauf-posten/{id}',
  handler: EssensplanungEinkaufPosten,
});
