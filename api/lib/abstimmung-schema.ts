/**
 * Input checks of the Abstimmungen as zod schemas. The types and constants live in
 * `abstimmung-model.ts`, which the pages import too and which must stay free of zod; only the
 * API and the mock API use this file.
 */
import { z } from 'zod';
import {
  ABSTIMMUNG_SICHTBARKEITEN,
  MAX_ABSTIMMUNG_OPTIONEN,
  maxAuswahlText,
} from './abstimmung-model';
import type {
  AbstimmungEingabe,
  AbstimmungOptionEingabe,
  AbstimmungRegeln,
} from './abstimmung-model';
import { ValidationError } from './validation/errors';
import { isRecord, parseWith } from './validation/zod';

/** Text of the form: trimmed; with `optional`, a missing value is `''`. */
function abstimmungText(label: string, max: number, optional = false) {
  const missing = `${label} fehlt.`;
  return z.preprocess(
    (value) => (optional && (value === undefined || value === null) ? '' : value),
    z
      .string({ error: missing })
      .trim()
      .min(optional ? 0 : 1, { error: missing })
      .max(max, { error: `${label} darf höchstens ${max} Zeichen haben.` })
  );
}

const MAX_AUSWAHL_MESSAGE = 'Bitte wähle, wie viele Optionen man wählen kann.';
const OPTIONEN_MISSING = 'Bitte trag mindestens zwei Optionen ein.';
const OPTIONEN_INVALID = 'Die Liste der Optionen ist ungültig.';

const optionTextSchema = abstimmungText('Der Text einer Option', 200, true);
const optionIdSchema = z
  .number({ error: OPTIONEN_INVALID })
  .int({ error: OPTIONEN_INVALID })
  .positive({ error: OPTIONEN_INVALID });

/**
 * The rows of the option list: empty rows are left out instead of blocking the save, the texts
 * are unique (ignoring case) and an existing ID appears once. The rows are read in order, so the
 * first problem is the one reported.
 */
const optionenSchema = z
  .array(z.unknown(), { error: OPTIONEN_MISSING })
  .transform((rows, ctx): AbstimmungOptionEingabe[] => {
    const fail = (message: string): never => {
      ctx.issues.push({ code: 'custom', message, input: rows });
      return z.NEVER;
    };
    const optionen: AbstimmungOptionEingabe[] = [];
    const texte = new Set<string>();
    const ids = new Set<number>();
    for (const row of rows) {
      const entry = isRecord(row) || Array.isArray(row) ? (row as Record<string, unknown>) : {};
      const text = optionTextSchema.safeParse(entry.text);
      if (!text.success) return fail(text.error.issues[0].message);
      // Empty rows of the form are left out instead of blocking the save
      if (!text.data) continue;
      const key = text.data.toLocaleLowerCase('de');
      if (texte.has(key)) return fail(`Die Option „${text.data}“ steht zweimal in der Liste.`);
      texte.add(key);
      if (entry.id === undefined || entry.id === null) {
        optionen.push({ text: text.data });
        continue;
      }
      const id = optionIdSchema.safeParse(entry.id);
      if (!id.success || ids.has(id.data)) return fail(OPTIONEN_INVALID);
      ids.add(id.data);
      optionen.push({ id: id.data, text: text.data });
    }
    if (optionen.length < 2) return fail(OPTIONEN_MISSING);
    if (optionen.length > MAX_ABSTIMMUNG_OPTIONEN) {
      return fail(`Höchstens ${MAX_ABSTIMMUNG_OPTIONEN} Optionen. Bitte nimm welche heraus.`);
    }
    return optionen;
  });

/** Votes per option ID; entries that do not fit are dropped, as the form only sends what it knew. */
const bekannteStimmenSchema = z
  .unknown()
  .optional()
  .transform((value): Record<number, number> => {
    const stimmen: Record<number, number> = {};
    if (!isRecord(value)) return stimmen;
    for (const [key, count] of Object.entries(value)) {
      if (/^\d{1,9}$/.test(key) && Number.isInteger(count) && (count as number) >= 0) {
        stimmen[Number(key)] = count as number;
      }
    }
    return stimmen;
  });

const abstimmungSchema = z.object({
  titel: abstimmungText('Die Frage', 200),
  beschreibung: abstimmungText('Die Beschreibung', 2000, true),
  maxAuswahl: z
    .number({ error: MAX_AUSWAHL_MESSAGE })
    .int({ error: MAX_AUSWAHL_MESSAGE })
    .min(1, { error: MAX_AUSWAHL_MESSAGE })
    .max(MAX_ABSTIMMUNG_OPTIONEN, { error: MAX_AUSWAHL_MESSAGE })
    .nullish()
    .transform((max) => max ?? null),
  vielleichtErlaubt: z
    .boolean({ error: 'Bitte wähle, ob „Vielleicht“ möglich ist.' })
    .default(false),
  sichtbarkeit: z.preprocess(
    (value) => value ?? 'offen',
    z.enum(ABSTIMMUNG_SICHTBARKEITEN, { error: 'Bitte wähle, wer die Antworten sieht.' })
  ),
  optionen: optionenSchema,
  bekannteStimmen: bekannteStimmenSchema,
});

/** Checks title, description, mode and options of the form. */
export function validateAbstimmung(body: Record<string, unknown> | null): AbstimmungEingabe {
  if (!body) throw new ValidationError({ form: 'Bitte prüfe die Eingaben.' });
  return parseWith(abstimmungSchema, body);
}

const abstimmungNameSchema = abstimmungText('Dein Name', 100).transform((name) =>
  name.replace(/\s+/g, ' ')
);

/** The name someone enters over the shared link. */
export function validateAbstimmungName(value: unknown): string {
  return parseWith(abstimmungNameSchema, value, () => 'name');
}

const AUSWAHL_INVALID = 'Die Auswahl ist ungültig. Bitte lade die Seite neu.';

/** The chosen option IDs of one list: an array that is no longer than the options, all known. */
function chosenIds(optionIds: readonly number[]) {
  const known = new Set(optionIds);
  const unknown = 'Eine Option gibt es nicht mehr. Bitte lade die Seite neu.';
  return z
    .array(z.unknown(), { error: AUSWAHL_INVALID })
    .max(optionIds.length, { error: AUSWAHL_INVALID })
    .pipe(
      z.array(
        z.number({ error: unknown }).refine((id) => known.has(id), { error: unknown }),
        { error: AUSWAHL_INVALID }
      )
    )
    .transform((ids) => new Set(ids));
}

/** The answer against the rules: `Ja` and `Vielleicht` are told apart and the limits checked. */
function antwortSchema({ optionIds, maxAuswahl, vielleichtErlaubt }: AbstimmungRegeln) {
  return z
    .object({ gewaehlt: chosenIds(optionIds), vielleicht: chosenIds(optionIds) })
    .transform((answer, ctx) => {
      const { gewaehlt: ja, vielleicht } = answer;
      const fail = (message: string): never => {
        ctx.issues.push({ code: 'custom', message, input: answer, path: ['gewaehlt'] });
        return z.NEVER;
      };
      if (vielleicht.size > 0 && !vielleichtErlaubt) {
        return fail(
          '„Vielleicht“ geht bei dieser Abstimmung nicht mehr. Bitte lade die Seite neu.'
        );
      }
      if ([...vielleicht].some((id) => ja.has(id))) return fail(AUSWAHL_INVALID);
      if (maxAuswahl !== null && ja.size > maxAuswahl) return fail(maxAuswahlText(maxAuswahl));
      return {
        gewaehlt: optionIds.filter((id) => ja.has(id)),
        vielleicht: optionIds.filter((id) => vielleicht.has(id)),
      };
    });
}

/**
 * The chosen options: existing IDs, each once and either with „Ja“ or „Vielleicht“, at most
 * `maxAuswahl` with „Ja“ (any number with „Vielleicht“). Empty lists are an answer too: none of
 * the options fits.
 */
export function validateAntwort(
  gewaehltValue: unknown,
  vielleichtValue: unknown,
  regeln: AbstimmungRegeln
): { gewaehlt: number[]; vielleicht: number[] } {
  return parseWith(
    antwortSchema(regeln),
    { gewaehlt: gewaehltValue, vielleicht: vielleichtValue ?? [] },
    () => 'gewaehlt'
  );
}
