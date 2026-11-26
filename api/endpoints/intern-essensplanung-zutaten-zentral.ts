import { app, type HttpResponseInit } from '@azure/functions';
import { doppelteFinden } from '../lib/essen-ki-doppelte';
import { kiFehlerAntwort } from '../lib/essen-ki-http';
import { loadEssenSteuerung } from '../lib/essen-steuerung';
import {
  listPlanungsZutaten,
  planungsZutatUebernehmen,
  zentraleZutatenZusammenlegen,
} from '../lib/essen-zutat-zentral';
import { ok } from '../lib/pflege-api';
import type { ClientPrincipal } from '../lib/staff-auth';
import { hasTeam } from '../lib/staff-auth';
import { staffHandler, type StaffRequestHandler, type StaffHandlerOptions } from '../lib/handler';
import { errorResponse, readJsonBody } from '../lib/response-utils';
import { ValidationError } from '../lib/validation/errors';

/**
 * The central list and the Planungen (`docs/essensplanung.md`, „Zentrale Zutatenliste“): own
 * ingredients of the Planungen to take over, and duplicates of the list found by the AI and
 * merged. Teams Admin and Vorstand, like the Steuerung.
 */

const AREA = 'essensplanung-steuerung';

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die zentrale Zutatenliste ist nur für die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

function steuerung(handler: StaffRequestHandler, options?: StaffHandlerOptions) {
  return staffHandler(
    AREA,
    async (request, context, principal: ClientPrincipal) => {
      if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;
      return handler(request, context, principal);
    },
    options
  );
}

function readId(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  throw new ValidationError({ [field]: 'Bitte eine Zutat wählen.' });
}

/** GET: the own ingredients of all Planungen, by name. */
export const EssensplanungPlanungsZutaten = steuerung(async () =>
  ok({ zutaten: await listPlanungsZutaten() })
);

/**
 * POST `{ name, zielId }` or `{ name, zutat }`: takes the own ingredients named `name` into the
 * list, as the existing ingredient `zielId` or as a new one; answers with the new state.
 */
export const EssensplanungZutatUebernehmen = steuerung(async (request, _context, principal) => {
  const ergebnis = await planungsZutatUebernehmen(
    await readJsonBody(request),
    principal.userDetails
  );
  const [view, zutaten] = await Promise.all([loadEssenSteuerung(), listPlanungsZutaten()]);
  return ok({ ...ergebnis, view, planungsZutaten: zutaten });
});

/** POST `{ von, nach }`: merges the central ingredient `von` into `nach`. */
export const EssensplanungZutatenZusammenlegen = steuerung(async (request, _context, principal) => {
  const body = await readJsonBody(request);
  const planungen = await zentraleZutatenZusammenlegen(
    readId(body?.von, 'von'),
    readId(body?.nach, 'nach'),
    principal.userDetails
  );
  return ok({ planungen, view: await loadEssenSteuerung() });
});

/** POST: groups of central ingredients the AI takes for duplicates (`KiDoppelte`). */
export const EssensplanungKiDoppelte = steuerung(
  async (): Promise<HttpResponseInit> => {
    try {
      return ok(await doppelteFinden());
    } catch (error: unknown) {
      const antwort = kiFehlerAntwort(error);
      if (antwort) return antwort;
      throw error;
    }
  },
  { readOnly: true }
);

app.http('internEssensplanungPlanungsZutaten', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/planungs-zutaten',
  handler: EssensplanungPlanungsZutaten,
});

app.http('internPflegeEssensplanungZutatUebernehmen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung-zutaten/uebernehmen',
  handler: EssensplanungZutatUebernehmen,
});

app.http('internPflegeEssensplanungZutatenZusammenlegen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung-zutaten/zusammenlegen',
  handler: EssensplanungZutatenZusammenlegen,
});

app.http('internEssensplanungKiDoppelte', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/essensplanung/ki/doppelte',
  handler: EssensplanungKiDoppelte,
});
