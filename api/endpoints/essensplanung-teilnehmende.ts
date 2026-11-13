import { app } from '@azure/functions';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { readPosition, validateEinplanung } from '../lib/essen-planung-validation';
import { einplanen, einplanungAendern, einplanungLoeschen } from '../lib/essen-einplanung';
import {
  gruppeAendern,
  gruppeAnlegen,
  gruppeLoeschen,
  teilnehmendeAendern,
  teilnehmendeAnlegen,
  teilnehmendeLoeschen,
} from '../lib/essen-teilnehmende';
import { validateGruppe, validateTeilnehmende } from '../lib/essen-teilnehmende-validation';
import { ok, planungHandler, readEtag, readId, zugangVon } from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/response-utils';

/** POST `{ mahlzeitId, gerichtId, faktor, zustaendigId, zustaendigText, position? }`: plans a dish. */
export const EssensplanungEinplanungen = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await einplanen(zugang, validateEinplanung(body), readPosition(body?.position));
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, mahlzeitId, gerichtId, faktor, zustaendigId, zustaendigText, position? }`:
 * changes or moves a planned dish. DELETE (If-Match): takes it off the meal.
 */
export const EssensplanungEinplanung = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await einplanungLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await einplanungAendern(
    zugang,
    id,
    validateEinplanung(body),
    readEtag(body, request),
    readPosition(body?.position)
  );
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ name, faktor }`: adds a group. */
export const EssensplanungGruppen = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await gruppeAnlegen(zugang, validateGruppe(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, name, faktor }`: changes a group. DELETE (If-Match): only without participants. */
export const EssensplanungGruppe = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await gruppeLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await gruppeAendern(zugang, id, validateGruppe(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ gruppeId, ernaehrung, anzahl, unvertraeglichkeiten, vonMahlzeitId, bisMahlzeitId, hinweis }`. */
export const EssensplanungTeilnehmendeListe = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await teilnehmendeAnlegen(zugang, validateTeilnehmende(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, …the whole row }`: changes a row of participants. DELETE (If-Match). */
export const EssensplanungTeilnehmende = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await teilnehmendeLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await teilnehmendeAendern(zugang, id, validateTeilnehmende(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

app.http('essensplanungEinplanungen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einplanungen',
  handler: EssensplanungEinplanungen,
});

app.http('essensplanungGruppen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gruppen',
  handler: EssensplanungGruppen,
});

app.http('essensplanungGruppe', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gruppen/{id}',
  handler: EssensplanungGruppe,
});

app.http('essensplanungTeilnehmendeListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/teilnehmende',
  handler: EssensplanungTeilnehmendeListe,
});

app.http('essensplanungTeilnehmende', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/teilnehmende/{id}',
  handler: EssensplanungTeilnehmende,
});

app.http('essensplanungEinplanung', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/einplanungen/{id}',
  handler: EssensplanungEinplanung,
});
