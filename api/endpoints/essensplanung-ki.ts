import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { gerichtZutatenSammeln, readPersonen } from '../lib/essen-gericht-zeilen';
import {
  readKopf,
  readPersonenSetzen,
  validateGerichtZutat,
} from '../lib/essen-gerichte-validation';
import type { GerichtZutatInput } from '../lib/essen-gerichte-validation';
import { MAX_ZEILEN_PRO_GERICHT } from '../lib/essen-gerichte-model';
import {
  KiNichtVerfuegbar,
  gerichtPruefen,
  rezeptLesen,
  umrechnungSchaetzen,
} from '../lib/essen-ki';
import { einheitenVorschlagen } from '../lib/essen-ki-einheiten';
import { gerichtGenerieren } from '../lib/essen-ki-generieren';
import { KI_MASSE, MAX_GERICHT_BESCHREIBUNG, MAX_REZEPT_TEXT } from '../lib/essen-ki-model';
import type { KiMass } from '../lib/essen-ki-model';
import { ladeAnsicht } from '../lib/essen-ansicht';
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

/** POST `{ beschreibung }`: a whole dish written by the AI, not saved yet (`KiGericht`). */
export const EssensplanungKiGenerieren = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  const body = await readJsonBody(request);
  const beschreibung = typeof body?.beschreibung === 'string' ? body.beschreibung.trim() : '';
  if (!beschreibung)
    throw new ValidationError({ beschreibung: 'Bitte beschreiben, was es geben soll.' });
  if (beschreibung.length > MAX_GERICHT_BESCHREIBUNG)
    throw new ValidationError({
      beschreibung: `Höchstens ${MAX_GERICHT_BESCHREIBUNG.toLocaleString('de-DE')} Zeichen.`,
    });
  return kiAntwort(() => gerichtGenerieren(zugang, id, beschreibung));
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

/** POST `{ planungZutatId }`: a common unit and factors for the amounts of one ingredient. */
export const EssensplanungKiEinheiten = planungHandler(async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const body = await readJsonBody(request);
  const id = body?.planungZutatId;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0)
    throw new ValidationError({ planungZutatId: 'Bitte eine Zutat wählen.' });
  return kiAntwort(() => einheitenVorschlagen(zugang, id));
});

/**
 * The lines of a batch; an error of a line names its field as `zeilen.<index>.<field>`. None is
 * only enough when the batch sets fields of the dish (`leer`).
 */
function validateZeilen(
  body: Record<string, unknown> | null,
  { leer }: { leer: boolean }
): GerichtZutatInput[] {
  const zeilen = body?.zeilen ?? (leer ? [] : undefined);
  if (!Array.isArray(zeilen) || (zeilen.length === 0 && !leer))
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

/**
 * POST `{ zeilen: [line, …], personen?, personenSetzen?, kopf? }`: adds lines at the end of a dish
 * in one change, all or none; `personenSetzen` sets the people of the dish and `kopf`
 * (`{ etag, anleitung?, werkzeuge? }`) its instructions and tools in the same change.
 */
export const EssensplanungGerichtZutatenSammel = planungHandler(async (request: HttpRequest) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const zugang = await zugangVon(request);
  const id = readId(request);
  const body = await readJsonBody(request);
  const kopf = readKopf(body);
  const zeilen = validateZeilen(body, { leer: kopf !== undefined });
  const personenSetzen = readPersonenSetzen(body);
  // The people the amounts were scaled for: a change meanwhile is a conflict
  await gerichtZutatenSammeln(zugang, id, zeilen, readPersonen(body), personenSetzen, kopf);
  return ok(await ladeAnsicht(zugang), 201);
});

app.http('essensplanungGerichtZutatenSammel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/zutaten/sammel',
  handler: EssensplanungGerichtZutatenSammel,
});

app.http('essensplanungKiPruefen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/ki/pruefen',
  handler: EssensplanungKiPruefen,
});

app.http('essensplanungKiRezept', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/ki/rezept',
  handler: EssensplanungKiRezept,
});

app.http('essensplanungKiGenerieren', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/gerichte/{id}/ki/generieren',
  handler: EssensplanungKiGenerieren,
});

app.http('essensplanungKiUmrechnung', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ki/umrechnung',
  handler: EssensplanungKiUmrechnung,
});

app.http('essensplanungKiEinheiten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/planung/ki/einheiten',
  handler: EssensplanungKiEinheiten,
});
