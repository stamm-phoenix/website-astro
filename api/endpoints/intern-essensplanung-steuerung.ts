import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { z } from 'zod';
import type { ClientPrincipal } from '../lib/staff-auth';
import { hasTeam } from '../lib/staff-auth';
import {
  createKategorie,
  createUnvertraeglichkeit,
  createZutat,
  deleteKategorie,
  deleteUnvertraeglichkeit,
  deleteZutat,
  renameKategorie,
  renameUnvertraeglichkeit,
  updateZutat,
} from '../lib/essen-katalog-pflege';
import {
  deletePlanungSteuerung,
  loadEssenSteuerung,
  saveEssenEinstellungen,
} from '../lib/essen-steuerung';
import {
  validateEssenEinstellungen,
  validateListName,
  validateZutat,
} from '../lib/essen-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ok,
  readEtag,
  readIfMatch,
  requireEtag,
} from '../lib/pflege-api';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { staffHandler, type StaffRequestHandler } from '../lib/handler';

/** The area in `staffHandler`; it is no public content, so no website build follows. */
const AREA = 'essensplanung-steuerung';

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die Steuerung der Essensplanung ist nur für die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

/** Like `staffHandler`, and the user must be in the team Admin or Vorstand. */
function steuerungHandler(handler: StaffRequestHandler) {
  return staffHandler(AREA, async (request, context, principal) => {
    if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;
    return handler(request, context, principal);
  });
}

/** GET: settings, central lists and log. */
export const EssensplanungSteuerung = steuerungHandler(async () => {
  return ok(await loadEssenSteuerung());
});

/** PUT `{ etag, einstellungen }`: saves switches and templates; answers with the whole view. */
export const EssensplanungEinstellungen = steuerungHandler(
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    const body = await readJsonBody(request);
    const etag = requireEtag(readEtag(body));
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
      const etag = requireEtag(readIfMatch(request));
      if (liste === 'planungen') await deletePlanungSteuerung(id, etag, actor);
      else if (liste === 'zutaten') await deleteZutat(id, etag, actor);
      else if (liste === 'kategorien') await deleteKategorie(id, etag, actor);
      else await deleteUnvertraeglichkeit(id, etag, actor);
      return ok(await loadEssenSteuerung());
    }

    if (liste === 'planungen') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const etag = requireEtag(readEtag(body));
    if (liste === 'zutaten') await updateZutat(id, validateZutat(body), etag, actor);
    else if (liste === 'kategorien') await renameKategorie(id, validateListName(body), etag, actor);
    else await renameUnvertraeglichkeit(id, validateListName(body), etag, actor);
    return ok(await loadEssenSteuerung());
  }
);

// Essensplanung: the Steuerung for the teams Admin and Vorstand (docs/essensplanung.md).
app.http('internEssensplanungSteuerung', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/steuerung',
  handler: EssensplanungSteuerung,
});

app.http('internPflegeEssensplanungEinstellungen', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/einstellungen',
  handler: EssensplanungEinstellungen,
});

app.http('internPflegeEssensplanungListe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/{liste}',
  handler: EssensplanungListe,
});

app.http('internPflegeEssensplanungListeEintrag', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung/{liste}/{id}',
  handler: EssensplanungListeEintrag,
});
