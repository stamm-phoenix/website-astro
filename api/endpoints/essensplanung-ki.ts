import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { gerichtZutatenSammeln } from '../lib/essen-gericht-zeilen';
import { validateGerichtZutat } from '../lib/essen-gerichte-validation';
import type { GerichtZutatInput } from '../lib/essen-gerichte-validation';
import { MAX_ZEILEN_PRO_GERICHT } from '../lib/essen-gerichte-model';
import {
  KiNichtVerfuegbar,
  gerichtPruefen,
  rezeptLesen,
  umrechnungSchaetzen,
} from '../lib/essen-ki';
import { KI_MASSE, MAX_REZEPT_TEXT } from '../lib/essen-ki-model';
import type { KiMass } from '../lib/essen-ki-model';
import { ladeAnsicht } from '../lib/essen-planung';
import {
  METHOD_NOT_ALLOWED,
  ok,
  planungHandler,
  readId,
  zugangVon,
} from '../lib/essen-planung-http';
import { NO_STORE_HEADERS, readJsonBody } from '../lib/nikolaus-api';
import { ValidationError } from '../lib/validation/errors';

/**
 * The AI of a Planung (`docs/essensplanung.md`, „KI“) and the endpoint that takes over the lines
 * of a recipe in one change. The AI only answers; nothing is saved until the page sends the
 * lines the member confirmed. A busy deployment answers 429 or 503 with `Retry-After`.
 */

/** Runs a question to the AI; a busy deployment becomes „KI gerade nicht verfügbar“. */
async function kiAntwort(work: () => Promise<unknown>): Promise<HttpResponseInit> {
  try {
    return ok(await work());
  } catch (error: unknown) {
    if (!(error instanceof KiNichtVerfuegbar)) throw error;
    return {
      status: error.status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { 'Retry-After': String(error.retryAfterSeconds) }),
      },
      jsonBody: {
        error: 'KI_NICHT_VERFUEGBAR',
        code: 'KI_NICHT_VERFUEGBAR',
        message: error.message,
        ...(error.retryAfterSeconds === undefined ? {} : { retryAfter: error.retryAfterSeconds }),
      },
    };
  }
}

/** POST: hints on a dish, each with a proposal (`KiPruefung`). */
export const EssensplanungKiPruefen = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  return kiAntwort(() => gerichtPruefen(zugang, id));
});

/** POST `{ text }`: the lines of a pasted recipe for the dish, not saved yet (`KiRezept`). */
export const EssensplanungKiRezept = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  const body = await readJsonBody(request);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) throw new ValidationError({ text: 'Bitte ein Rezept einfügen.' });
  if (text.length > MAX_REZEPT_TEXT)
    throw new ValidationError({
      text: `Höchstens ${MAX_REZEPT_TEXT.toLocaleString('de-DE')} Zeichen. Bitte nur die Zutaten einfügen.`,
    });
  return kiAntwort(() => rezeptLesen(zugang, id, text));
});

/** POST `{ zutatId | planungZutatId, mass }`: estimated grams of one TL, EL or piece. */
export const EssensplanungKiUmrechnung = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const id = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
  const zutatId = id(body?.zutatId);
  const planungZutatId = id(body?.planungZutatId);
  const mass = KI_MASSE.find((entry) => entry === body?.mass);
  if (zutatId === null && planungZutatId === null)
    throw new ValidationError({ zutat: 'Bitte eine Zutat wählen.' });
  if (!mass) throw new ValidationError({ mass: 'Bitte TL, EL oder Stück wählen.' });
  const wahl = zutatId !== null ? { zutatId } : { planungZutatId: planungZutatId! };
  return kiAntwort(() => umrechnungSchaetzen(zugang, wahl, mass as KiMass));
});

/** The lines of a batch; an error of a line names its field as `zeilen.<index>.<field>`. */
function validateZeilen(body: Record<string, unknown> | null): GerichtZutatInput[] {
  const zeilen = body?.zeilen;
  if (!Array.isArray(zeilen) || zeilen.length === 0)
    throw new ValidationError({ zeilen: 'Bitte mindestens eine Zutat auswählen.' });
  if (zeilen.length > MAX_ZEILEN_PRO_GERICHT)
    throw new ValidationError({
      zeilen: `Ein Gericht hat höchstens ${MAX_ZEILEN_PRO_GERICHT} Zutaten.`,
    });
  const fehler: Record<string, string> = {};
  const inputs = zeilen.map((zeile, index) => {
    try {
      return validateGerichtZutat(zeile);
    } catch (error: unknown) {
      if (!(error instanceof ValidationError)) throw error;
      for (const [feld, text] of Object.entries(error.fields))
        fehler[`zeilen.${index}.${feld}`] = text;
      return null;
    }
  });
  if (Object.keys(fehler).length) throw new ValidationError(fehler);
  return inputs as GerichtZutatInput[];
}

/** POST `{ zeilen: [line, …] }`: adds lines at the end of a dish in one change, all or none. */
export const EssensplanungGerichtZutatenSammel = planungHandler(async (request: HttpRequest) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  await gerichtZutatenSammeln(zugang, id, validateZeilen(await readJsonBody(request)));
  return ok(await ladeAnsicht(zugang), 201);
});
