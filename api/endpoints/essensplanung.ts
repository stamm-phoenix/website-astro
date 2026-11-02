import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isAltchaConfigured, verifyAltchaPayload } from '../lib/altcha';
import {
  bestaetigungMail,
  einladungMail,
  essenMail,
  meinePlanungenMail,
  neuerLinkMail,
} from '../lib/essen-mails';
import {
  PlanungError,
  anfrageAnlegen,
  anfrageBestaetigen,
  beitreten,
  beitrittAnsehen,
  eigenenNamenAendern,
  einladen,
  gemeinsamerLink,
  ladeAnsicht,
  ladeStand,
  linkZuruecknehmen,
  mahlzeitAendern,
  mahlzeitHinzufuegen,
  mahlzeitLoeschen,
  mitgliedAendern,
  neueLinksFuerAdresse,
  neuerLink,
  planungAendern,
  planungLoeschen,
  tagHinzufuegen,
  tagLoeschen,
  tagVerschieben,
} from '../lib/essen-planung';
import {
  readPosition,
  validateAnlegen,
  validateBeitritt,
  validateEinladung,
  validateEmail,
  validateMahlzeit,
  validateMitgliedName,
  validatePlanungEinstellungen,
  validateEinplanung,
  validateTag,
} from '../lib/essen-planung-validation';
import { einplanen, einplanungAendern, einplanungLoeschen } from '../lib/essen-einplanung';
import {
  gruppeAendern,
  gruppeAnlegen,
  gruppeLoeschen,
  mahlzeitGruppeSetzen,
  teilnehmendeAendern,
  teilnehmendeAnlegen,
  teilnehmendeLoeschen,
} from '../lib/essen-teilnehmende';
import { validateGruppe, validateTeilnehmende } from '../lib/essen-teilnehmende-validation';
import { gerichtAendern, gerichtAnlegen, gerichtLoeschen } from '../lib/essen-gericht';
import {
  eigeneZutatAnlegen,
  ladeKatalog,
  planungZutatAendern,
  planungZutatLoeschen,
} from '../lib/essen-gerichte';
import {
  gerichtZutatAendern,
  gerichtZutatAnlegen,
  gerichtZutatLoeschen,
  readPersonen,
} from '../lib/essen-gericht-zeilen';
import {
  validateGericht,
  validateNeuesGericht,
  validateGerichtZutat,
  validatePlanungZutat,
} from '../lib/essen-gerichte-validation';
import { readGemeinsamerLink, readRolle, readTagId } from '../lib/essen-planung-request';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readEtag,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { ValidationError } from '../lib/validation/errors';
import { errorResponse } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import { isPreviewDeployment } from '../lib/staff-auth';

/**
 * Public API of the Essensplanung (`docs/essensplanung.md`). There is no login: the personal or
 * read-only link carries a token, which the page sends in the header `x-essensplanung-token`.
 * Changes answer with the whole view of the Planung, conflicts with status 409 and the current
 * view. PR previews send no mail; they return the link in `vorschauLink(s)` instead.
 */

const CAPTCHA_FAILED: HttpResponseInit = {
  ...errorResponse(
    403,
    'CAPTCHA_FAILED',
    'Die Sicherheitsprüfung ist abgelaufen. Bitte schick das Formular noch einmal ab.'
  ),
  headers: NO_STORE_HEADERS,
};

const UNAVAILABLE: HttpResponseInit = {
  ...errorResponse(
    503,
    'UNAVAILABLE',
    'Das Formular ist gerade nicht verfügbar. Bitte versuche es später noch einmal.'
  ),
  headers: NO_STORE_HEADERS,
};

const MAIL_FAILED: HttpResponseInit = {
  ...errorResponse(
    502,
    'MAIL_FAILED',
    'Die Mail konnte nicht verschickt werden. Bitte versuche es in ein paar Minuten noch einmal.'
  ),
  headers: NO_STORE_HEADERS,
};

function link(request: HttpRequest, path: string, param: string, token: string): string {
  return `${getSiteUrl(request)}${path}#${new URLSearchParams({ [param]: token })}`;
}

const planungLink = (request: HttpRequest, token: string) =>
  link(request, '/essensplanung/planung', 't', token);

/** Sends a mail, or on a PR preview returns the link it would contain. */
async function verschicke(
  to: string,
  mail: { subject: string; html: string },
  vorschau: string,
  context: InvocationContext
): Promise<{ gesendet: boolean; vorschauLink?: string }> {
  if (isPreviewDeployment()) return { gesendet: false, vorschauLink: vorschau };
  try {
    await essenMail.send(to, mail.subject, mail.html);
    return { gesendet: true };
  } catch (error: unknown) {
    context.error(
      '[essensplanung] Mail nicht verschickt',
      error instanceof Error ? error.message : error
    );
    return { gesendet: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Creating, joining, „Meine Planungen“
// ---------------------------------------------------------------------------------------------

/** POST `{ altcha, email, name, planungName, ersterTag, letzterTag }`: mails the confirmation link. */
export const EssensplanungAnlegen = planungHandler(async (request, context) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  if (!isAltchaConfigured()) return UNAVAILABLE;
  const body = await readJsonBody(request);
  const input = validateAnlegen(body);
  if (!(await verifyAltchaPayload(body?.altcha))) return CAPTCHA_FAILED;
  const token = await anfrageAnlegen(input);
  const bestaetigen = link(request, '/essensplanung/bestaetigen', 'a', token);
  const versand = await verschicke(
    input.email,
    bestaetigungMail(input.name, input.planungName, bestaetigen),
    bestaetigen,
    context
  );
  if (!versand.gesendet && !versand.vorschauLink) return MAIL_FAILED;
  return ok(
    versand.vorschauLink
      ? { email: input.email, vorschauLink: versand.vorschauLink }
      : { email: input.email }
  );
});

/** POST `{ token }`: creates the Planung of a confirmed request; answers with the owner's token. */
export const EssensplanungBestaetigen = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  return ok({ token: await anfrageBestaetigen(body?.token) }, 201);
});

/**
 * POST `{ altcha, email }`: mails new links to all Planungen of the address. The answer is the
 * same whether the address is known or not.
 */
export const EssensplanungMeine = planungHandler(async (request, context) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  if (!isAltchaConfigured()) return UNAVAILABLE;
  const body = await readJsonBody(request);
  const email = validateEmail(body);
  if (!(await verifyAltchaPayload(body?.altcha))) return CAPTCHA_FAILED;
  const links = await neueLinksFuerAdresse(email);
  const eintraege = links.map((entry) => ({
    planungName: entry.planungName,
    link: planungLink(request, entry.token),
  }));
  let vorschauLinks: typeof eintraege | undefined;
  if (eintraege.length) {
    const versand = await verschicke(email, meinePlanungenMail(eintraege), '', context);
    if (versand.vorschauLink !== undefined) vorschauLinks = eintraege;
    // Without the mail the old links keep working; the answer stays the same for every address
    else if (!versand.gesendet) await Promise.all(links.map(linkZuruecknehmen));
  }
  return ok(vorschauLinks ? { email, vorschauLinks } : { email });
});

/** POST `{ token }`: the name of the Planung behind a join link. */
export const EssensplanungBeitrittAnsehen = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  return ok(await beitrittAnsehen(body?.token));
});

/** POST `{ token, name, email? }`: joins the Planung; answers with the personal token. */
export const EssensplanungBeitreten = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  const input = validateBeitritt(body);
  return ok({ token: await beitreten(body?.token, input) }, 201);
});

// ---------------------------------------------------------------------------------------------
// The Planung
// ---------------------------------------------------------------------------------------------

/**
 * GET: the view of the Planung. PATCH `{ name, mitgliederVerwalten }` (owners). DELETE deletes
 * it with everything in it (owners).
 */
export const EssensplanungPlanung = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  if (request.method === 'GET') return ok(await ladeAnsicht(zugang));
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
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const stand = await ladeStand(zugang);
  if (stand === request.query.get('seit')) return ok({ stand });
  const ansicht = await ladeAnsicht(zugang);
  return ok({ stand: ansicht.stand, ansicht });
});

/** PATCH `{ name }`: one's own name. */
export const EssensplanungIch = planungHandler(async (request) => {
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  if (zugang.mitgliedId === null)
    throw new PlanungError(403, 'NUR_LESEN', 'Mit diesem Link kannst du die Planung nur ansehen.');
  await eigenenNamenAendern(zugang, validateMitgliedName(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ art: 'beitritt'|'lesen', an }`: new shared link (the old one stops) or off. */
export const EssensplanungLinks = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const { art, an } = readGemeinsamerLink(body);
  await gemeinsamerLink(zugang, art, an);
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ name, email, rolle }`: invites by mail. */
export const EssensplanungMitglieder = planungHandler(async (request, context) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  const rolle = readRolle(body);
  await mitgliedAendern(zugang, id, { rolle }, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST: sends a member a new link (the old one stops working). */
export const EssensplanungMitgliedLink = planungHandler(async (request, context) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await tagVerschieben(zugang, id, validateTag(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ tagId, name, uhrzeit?, position? }`: adds a meal to a day. */
export const EssensplanungMahlzeiten = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await mahlzeitAendern(
    zugang,
    id,
    { ...validateMahlzeit(body), position: readPosition(body?.position) },
    readEtag(body, request)
  );
  return ok(await ladeAnsicht(zugang));
});

/** GET: the central lists (categories, allergens, ingredients) the dishes pick from. */
export const EssensplanungKatalog = planungHandler(async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  await zugangVon(request);
  return ok(await ladeKatalog());
});

/** POST `{ name, kategorieId, einheitenart, vegetarisch?, vegan?, allergene? }`: an own ingredient. */
export const EssensplanungZutaten = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = await eigeneZutatAnlegen(
    zugang,
    validatePlanungZutat(await readJsonBody(request), { eigene: true })
  );
  return ok({ id, ansicht: await ladeAnsicht(zugang) }, 201);
});

/**
 * PATCH `{ etag, … }`: all fields of an own ingredient, or `{ kategorieId, einheitenart }` as the
 * differences of a central one (null: as in the list). DELETE (If-Match): only while unused.
 */
export const EssensplanungZutat = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await planungZutatLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await planungZutatAendern(zugang, id, body, readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/**
 * POST `{ name, personen?, …, mahlzeitId?, faktor?, zustaendigId?, zustaendigText? }`: adds a
 * dish, with `mahlzeitId` planned at that meal in the same change; answers with its id and the
 * view.
 */
export const EssensplanungGerichte = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const { gericht, einplanung } = validateNeuesGericht(await readJsonBody(request));
  const id = await gerichtAnlegen(zugang, gericht, einplanung);
  return ok({ id, ansicht: await ladeAnsicht(zugang) }, 201);
});

/** PATCH `{ etag, …changed fields }`: changes a dish. DELETE (If-Match): with its lines. */
export const EssensplanungGericht = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await gerichtLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await gerichtAendern(zugang, id, validateGericht(body, { neu: false }), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ zutatId | planungZutatId, menge, einheit, …, position? }`: adds a line to a dish. */
export const EssensplanungGerichtZutaten = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  await gerichtZutatAnlegen(
    zugang,
    readId(request),
    validateGerichtZutat(body),
    readPosition(body?.position)
  );
  return ok(await ladeAnsicht(zugang), 201);
});

/**
 * PATCH `{ etag, …the whole line, position?, personen? }`: changes or moves a line; `personen`
 * (a proposal of the AI) must still be the dish's. DELETE (If-Match).
 */
export const EssensplanungGerichtZutat = planungHandler(async (request) => {
  const zugang = await zugangVon(request);
  const id = readId(request);
  if (request.method === 'DELETE') {
    await gerichtZutatLoeschen(zugang, id, readEtag(null, request));
    return ok(await ladeAnsicht(zugang));
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await gerichtZutatAendern(
    zugang,
    id,
    { ...validateGerichtZutat(body), position: readPosition(body?.position) },
    readEtag(body, request),
    readPersonen(body)
  );
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ mahlzeitId, gerichtId, faktor, zustaendigId, zustaendigText, position? }`: plans a dish. */
export const EssensplanungEinplanungen = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await gruppeAendern(zugang, id, validateGruppe(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** POST `{ gruppeId, ernaehrung, anzahl, unvertraeglichkeiten, vonMahlzeitId, bisMahlzeitId, hinweis }`. */
export const EssensplanungTeilnehmendeListe = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
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
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
  const body = await readJsonBody(request);
  await teilnehmendeAendern(zugang, id, validateTeilnehmende(body), readEtag(body, request));
  return ok(await ladeAnsicht(zugang));
});

/** PUT `{ gruppeId, isst }`: whether a group eats at the meal. */
export const EssensplanungMahlzeitGruppe = planungHandler(async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const gruppeId =
    typeof body?.gruppeId === 'number' && Number.isInteger(body.gruppeId) ? body.gruppeId : 0;
  if (gruppeId <= 0 || typeof body?.isst !== 'boolean')
    throw new ValidationError({ gruppeId: 'Bitte eine Gruppe wählen.' });
  await mahlzeitGruppeSetzen(zugang, readId(request), gruppeId, body.isst);
  return ok(await ladeAnsicht(zugang));
});
