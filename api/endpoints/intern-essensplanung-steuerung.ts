import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import type { ClientPrincipal } from '../lib/staff-auth';
import { hasTeam } from '../lib/staff-auth';
import {
  createKategorie,
  createUnvertraeglichkeit,
  createZutat,
  deleteKategorie,
  deletePlanungSteuerung,
  deleteUnvertraeglichkeit,
  deleteZutat,
  loadEssenSteuerung,
  renameKategorie,
  renameUnvertraeglichkeit,
  saveEssenEinstellungen,
  updateZutat,
} from '../lib/essen-steuerung';
import {
  validateEssenEinstellungen,
  validateListName,
  validateZutat,
} from '../lib/essen-validation';
import type { PflegeHandler } from '../lib/pflege-api';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/** The area in `pflegeHandler`; it is no public content, so no website build follows. */
const AREA = 'essensplanung-steuerung';

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die Steuerung der Essensplanung ist nur für die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

/** Like `pflegeHandler`, and the user must be in the team Admin or Vorstand. */
function steuerungHandler(handler: PflegeHandler) {
  return pflegeHandler(AREA, async (request, context, principal) => {
    if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;
    return handler(request, context, principal);
  });
}

/** GET: settings, central lists and log. */
export const EssensplanungSteuerung = steuerungHandler(async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  return ok(await loadEssenSteuerung());
});

/** PUT `{ etag, einstellungen }`: saves switches and templates; answers with the whole view. */
export const EssensplanungEinstellungen = steuerungHandler(
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    const einstellungen = validateEssenEinstellungen(body?.einstellungen);
    await saveEssenEinstellungen(einstellungen, etag, principal.userDetails);
    return ok(await loadEssenSteuerung());
  }
);

const listeSchema = z.enum(['zutaten', 'kategorien', 'unvertraeglichkeiten', 'planungen']);

function readListe(request: HttpRequest): z.output<typeof listeSchema> | undefined {
  const parsed = listeSchema.safeParse(request.params.liste);
  return parsed.success ? parsed.data : undefined;
}

/** POST: adds an ingredient, category or allergen; answers with the whole view. */
export const EssensplanungListe = steuerungHandler(
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    const liste = readListe(request);
    if (!liste || liste === 'planungen') return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const actor = principal.userDetails;
    let id: number;
    if (liste === 'zutaten') id = await createZutat(validateZutat(body), actor);
    else if (liste === 'kategorien') id = await createKategorie(validateListName(body), actor);
    else id = await createUnvertraeglichkeit(validateListName(body), actor);
    return ok({ id, view: await loadEssenSteuerung() }, 201);
  }
);

/**
 * PATCH `{ etag, … }`: changes the loaded version of an entry; DELETE with `If-Match`. Answers
 * with the whole view; a concurrent change returns 409.
 */
export const EssensplanungListeEintrag = steuerungHandler(
  async (
    request: HttpRequest,
    _context: InvocationContext,
    principal: ClientPrincipal
  ): Promise<HttpResponseInit> => {
    const liste = readListe(request);
    const id = request.params.id ?? '';
    if (!liste || !/^\d+$/.test(id)) return NOT_FOUND;
    const actor = principal.userDetails;

    if (request.method === 'DELETE') {
      const etag = requireVersion(readIfMatch(request));
      if (liste === 'planungen') await deletePlanungSteuerung(id, etag, actor);
      else if (liste === 'zutaten') await deleteZutat(id, etag, actor);
      else if (liste === 'kategorien') await deleteKategorie(id, etag, actor);
      else await deleteUnvertraeglichkeit(id, etag, actor);
      return ok(await loadEssenSteuerung());
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    if (liste === 'planungen') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    if (liste === 'zutaten') await updateZutat(id, validateZutat(body), etag, actor);
    else if (liste === 'kategorien') await renameKategorie(id, validateListName(body), etag, actor);
    else await renameUnvertraeglichkeit(id, validateListName(body), etag, actor);
    return ok(await loadEssenSteuerung());
  }
);

export const EssensplanungSteuerungEndpoint = withErrorHandling(EssensplanungSteuerung);
export const EssensplanungEinstellungenEndpoint = withErrorHandling(EssensplanungEinstellungen);
export const EssensplanungListeEndpoint = withErrorHandling(EssensplanungListe);
export const EssensplanungListeEintragEndpoint = withErrorHandling(EssensplanungListeEintrag);
