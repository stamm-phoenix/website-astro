import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { updateZutat } from '../lib/essen-katalog-pflege';
import { loadEssenSteuerung } from '../lib/essen-steuerung';
import { validateZutat } from '../lib/essen-validation';
import { ok } from '../lib/pflege-api';
import { hasTeam } from '../lib/staff-auth';
import { staffHandler } from '../lib/handler';
import { errorResponse, getErrorStatus, readJsonBody } from '../lib/response-utils';
import { ValidationError } from '../lib/validation/errors';

/**
 * Changes of many central ingredients at once (`docs/essensplanung.md`, „KI“): „Alle übernehmen“
 * of „Zutaten prüfen (KI)“. Each entry is saved on its own with the version the check saw, so a
 * conflict or an invalid entry leaves the others saved and is named in the answer.
 */

/** Entries per request; the page sends more in portions. */
export const MAX_ZUTATEN_SAMMEL = 50;

const NOT_ALLOWED = errorResponse(
  403,
  'NOT_IN_TEAM',
  'Die zentrale Zutatenliste ist nur für die Teams Admin und Vorstand. Bist du gerade erst in eines der Teams gekommen, melde dich ab und wieder an.'
);

/** Why one entry was not saved, in the words of the page; an unexpected error is logged. */
function fehlerText(error: unknown, context: InvocationContext): string {
  if (error instanceof ValidationError)
    return Object.values(error.fields ?? {})[0] ?? error.message;
  const status = getErrorStatus(error);
  if (status === 409 || status === 412)
    return 'Jemand hat die Zutat inzwischen geändert. Prüf sie noch einmal.';
  if (status === 404) return 'Die Zutat gibt es nicht mehr.';
  context.error('[essensplanung] Zutat der Sammelübernahme nicht gespeichert', error);
  return 'Die Zutat wurde nicht gespeichert. Tippe noch einmal auf „Übernehmen“.';
}

/**
 * POST `{ zutaten: [{ id, etag, …Zutat }] }`: saves each; answers
 * `{ ergebnisse: [{ id, fehler: string | null }], view }`.
 */
export const EssensplanungZutatenSammel = staffHandler(
  'essensplanung-steuerung',
  async (request, context, principal): Promise<HttpResponseInit> => {
    if (!hasTeam(principal, 'admin') && !hasTeam(principal, 'vorstand')) return NOT_ALLOWED;
    const body = await readJsonBody(request);
    const zutaten = body?.zutaten;
    if (!Array.isArray(zutaten) || !zutaten.length || zutaten.length > MAX_ZUTATEN_SAMMEL)
      throw new ValidationError({
        zutaten: `Bitte 1 bis ${MAX_ZUTATEN_SAMMEL} Zutaten auf einmal senden.`,
      });
    // Every entry is checked before the first is saved, so a malformed request saves nothing
    const eintraege = (zutaten as unknown[]).map(
      (eintrag) => (eintrag ?? {}) as Record<string, unknown>
    );
    for (const { id, etag } of eintraege) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || typeof etag !== 'string')
        throw new ValidationError({ zutaten: 'Jede Zutat braucht ihre Nummer und Version.' });
    }
    const ergebnisse: { id: number; fehler: string | null }[] = [];
    for (const record of eintraege) {
      const id = record.id as number;
      try {
        await updateZutat(
          String(id),
          validateZutat(record),
          record.etag as string,
          principal.userDetails
        );
        ergebnisse.push({ id, fehler: null });
      } catch (error: unknown) {
        ergebnisse.push({ id, fehler: fehlerText(error, context) });
      }
    }
    return ok({ ergebnisse, view: await loadEssenSteuerung() });
  }
);

app.http('internPflegeEssensplanungZutatenSammel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/essensplanung-zutaten/sammel',
  handler: EssensplanungZutatenSammel,
});
