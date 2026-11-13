import { app } from '@azure/functions';
import { getDb } from '../lib/db';
import { alsGeoeffnetMerken } from '../lib/essen-leitung';
import { einladungMail, neuerLinkMail } from '../lib/essen-mails';
import { PlanungError } from '../lib/essen-zugang';
import {
  eigenenNamenAendern,
  einladen,
  gemeinsamerLink,
  linkZuruecknehmen,
  mitgliedAendern,
  neuerLink,
} from '../lib/essen-planung-mitglieder';
import {
  mahlzeitAendern,
  mahlzeitHinzufuegen,
  mahlzeitLoeschen,
} from '../lib/essen-planung-mahlzeiten';
import { planungAendern, planungLoeschen } from '../lib/essen-planung';
import { tagHinzufuegen, tagLoeschen, tagVerschieben } from '../lib/essen-planung-tage';
import { ladeAnsicht } from '../lib/essen-ansicht';
import { ladeStand } from '../lib/essen-stand';
import {
  readPosition,
  validateEinladung,
  validateMahlzeit,
  validateMitgliedName,
  validatePlanungEinstellungen,
  validateTag,
} from '../lib/essen-planung-validation';
import { mahlzeitGruppeSetzen } from '../lib/essen-teilnehmende';
import { readGemeinsamerLink, readRolle, readTagId } from '../lib/essen-planung-request';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readEtag,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { ValidationError } from '../lib/validation/errors';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/response-utils';
import { link, planungLink, verschicke } from '../lib/essen-planung-versand';

// ---------------------------------------------------------------------------------------------
// The Planung
// ---------------------------------------------------------------------------------------------

/**
 * GET: the view of the Planung. PATCH `{ name, mitgliederVerwalten }` (owners). DELETE deletes
 * it with everything in it (owners).
 */
export const EssensplanungPlanung = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  if (request.method === 'GET') {
    // The first load ends an invitation on the start page of the Leitendenbereich
    if (zugang.mitgliedId !== null) await alsGeoeffnetMerken(getDb(), zugang.mitgliedId);
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method === 'PATCH') {
    await planungAendern(zugang, validatePlanungEinstellungen(await readJsonBody(request)));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method === 'DELETE') {
    await planungLoeschen(zugang);
    return { status: 204, headers: NO_STORE_HEADERS };
  }
  return METHOD_NOT_ALLOWED;
});

/** GET `?seit=<stand>`: only the `stand` while nothing changed, otherwise the whole view. */
export const EssensplanungStand = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const gelesen = await ladeStand(zugang);
  if (gelesen.stand === request.query.get('seit')) return ok({ stand: gelesen.stand });
  const ansicht = await ladeAnsicht(zugang, getDb(), gelesen);
  return ok({ stand: ansicht.stand, ansicht });
});

/** PATCH `{ name }`: one's own name. */
export const EssensplanungIch = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  if (zugang.mitgliedId === null)
    throw new PlanungError(403, 'NUR_LESEN', 'Mit diesem Link kannst du die Planung nur ansehen.');
  await eigenenNamenAendern(zugang, validateMitgliedName(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ art: 'beitritt'|'lesen', an }`: new shared link (the old one stops) or off. */
export const EssensplanungLinks = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const { art, an } = readGemeinsamerLink(body);
  await gemeinsamerLink(zugang, art, an);
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ name, email, rolle }`: invites by mail. */
export const EssensplanungMitglieder = planungHandler(async (request, context) => {
  const zugang = await zugangVon(request);
  const input = validateEinladung(await readJsonBody(request));
  const eingeladen = await einladen(zugang, input);
  const personal = planungLink(request, eingeladen.token);
  const versand = await verschicke(
    input.email,
    einladungMail(input.name, eingeladen.planungName, zugang.name, personal),
    personal,
    context
  );
  // The member stays; „Neuen Link schicken“ may try again at once
  if (!versand.gesendet && !versand.vorschauLink) await linkZuruecknehmen(eingeladen);
  return ok(
    {
      ansicht: await ladeAnsicht(zugang),
      gesendet: versand.gesendet,
      vorschauLink: versand.vorschauLink,
    },
    201
  );
});

/**
 * PATCH `{ etag, rolle }`: role of a member (owners). DELETE (If-Match): removes the access; the
 * member's link stops working at once.
 */
export const EssensplanungMitglied = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await mitgliedAendern(zugang, id, { entziehen: true }, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  const rolle = readRolle(body);
  await mitgliedAendern(zugang, id, { rolle }, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST: sends a member a new link (the old one stops working). */
export const EssensplanungMitgliedLink = planungHandler(async (request, context) => {
  const zugang = await zugangVon(request);
  const neu = await neuerLink(zugang, readId(request));
  const personal = planungLink(request, neu.token);
  const versand = await verschicke(
    neu.email,
    neuerLinkMail(neu.name, neu.planungName, personal),
    personal,
    context
  );
  // Without the mail the member keeps the old link
  if (!versand.gesendet && !versand.vorschauLink) await linkZuruecknehmen(neu);
  return ok({
    ansicht: await ladeAnsicht(zugang),
    gesendet: versand.gesendet,
    vorschauLink: versand.vorschauLink,
  });
});

/** POST `{ datum }`: adds a day with the template meals. */
export const EssensplanungTage = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  await tagHinzufuegen(zugang, validateTag(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, datum }`: moves a day. DELETE (If-Match): deletes it with its meals. */
export const EssensplanungTag = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await tagLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await tagVerschieben(zugang, id, validateTag(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ tagId, name, uhrzeit?, position? }`: adds a meal to a day. */
export const EssensplanungMahlzeiten = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const tagId = readTagId(body);
  await mahlzeitHinzufuegen(zugang, tagId, validateMahlzeit(body), readPosition(body?.position));
  return ok(await ladeAnsicht(zugang), 201);
});

/** PATCH `{ etag, name, uhrzeit?, position? }`: changes or moves a meal. DELETE (If-Match). */
export const EssensplanungMahlzeit = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await mahlzeitLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  const body = await readJsonBody(request);
  await mahlzeitAendern(
    zugang,
    id,
    { ...validateMahlzeit(body), position: readPosition(body?.position) },
    readEtag(body, request)
  );
  return ok(await ladeAnsicht(zugang));
});

/** PUT `{ gruppeId, isst }`: whether a group eats at the meal. */
export const EssensplanungMahlzeitGruppe = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const gruppeId =
    typeof body?.gruppeId === 'number' && Number.isInteger(body.gruppeId) ? body.gruppeId : 0;
  if (gruppeId <= 0 || typeof body?.isst !== 'boolean')
    throw new ValidationError({ gruppeId: 'Bitte eine Gruppe wählen.' });
  await mahlzeitGruppeSetzen(zugang, readId(request), gruppeId, body.isst);
  return ok(await ladeAnsicht(zugang));
});

app.http('essensplanungPlanung', {
  methods: ['GET', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung',
  handler: EssensplanungPlanung,
});

app.http('essensplanungStand', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/stand',
  handler: EssensplanungStand,
});

app.http('essensplanungIch', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ich',
  handler: EssensplanungIch,
});

app.http('essensplanungLinks', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/links',
  handler: EssensplanungLinks,
});

app.http('essensplanungMitglieder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder',
  handler: EssensplanungMitglieder,
});

app.http('essensplanungMitglied', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder/{id}',
  handler: EssensplanungMitglied,
});

app.http('essensplanungMitgliedLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mitglieder/{id}/link',
  handler: EssensplanungMitgliedLink,
});

app.http('essensplanungTage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/tage',
  handler: EssensplanungTage,
});

app.http('essensplanungTag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/tage/{id}',
  handler: EssensplanungTag,
});

app.http('essensplanungMahlzeiten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten',
  handler: EssensplanungMahlzeiten,
});

app.http('essensplanungMahlzeit', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten/{id}',
  handler: EssensplanungMahlzeit,
});

app.http('essensplanungMahlzeitGruppe', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/mahlzeiten/{id}/gruppen',
  handler: EssensplanungMahlzeitGruppe,
});
