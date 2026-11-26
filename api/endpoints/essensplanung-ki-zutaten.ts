import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { KiNichtVerfuegbar } from '../lib/essen-ki';
import { kiFehlerAntwort } from '../lib/essen-ki-http';
import { zentraleZutatenPruefen, zutatenDerPlanungPruefen } from '../lib/essen-ki-zutaten';
import { readKiZutatIds } from '../lib/essen-ki-zutaten-antwort';
import { ok, planungHandler, zugangVon } from '../lib/essen-planung-http';
import { hasTeam } from '../lib/staff-auth';
import { staffHandler } from '../lib/handler';
import { errorResponse, readJsonBody } from '../lib/response-utils';

/**
 * „Zutaten prüfen (KI)“ (`docs/essensplanung.md`, „KI“): the own ingredients of a Planung and the
 * central list. Only answers; the page saves what the user takes over.
 */

/** POST `{ ids }`: proposals for up to 25 own ingredients of the Planung (`KiZutatPruefung`). */
export const EssensplanungKiZutaten = planungHandler(async (request: HttpRequest) => {
  const zugang = await zugangVon(request);
  const ids = readKiZutatIds(await readJsonBody(request));
  try {
    return ok(await zutatenDerPlanungPruefen(zugang, ids));
  } catch (error: unknown) {
    if (error instanceof KiNichtVerfuegbar) return kiFehlerAntwort(error)!;
    throw error;
  }
});

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die zentrale Zutatenliste ist nur für die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

/** POST `{ ids }`: proposals for up to 25 central ingredients; teams Admin and Vorstand. */
export const EssensplanungKiZentraleZutaten = staffHandler(
  'essensplanung-steuerung',
  async (request, _context, principal): Promise<HttpResponseInit> => {
    if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;
    const ids = readKiZutatIds(await readJsonBody(request));
    try {
      return ok(await zentraleZutatenPruefen(ids));
    } catch (error: unknown) {
      const antwort = kiFehlerAntwort(error);
      if (antwort) return antwort;
      throw error;
    }
  },
  { readOnly: true }
);

app.http('essensplanungKiZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ki/zutaten',
  handler: EssensplanungKiZutaten,
});

app.http('internEssensplanungKiZutaten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/ki/zutaten',
  handler: EssensplanungKiZentraleZutaten,
});
