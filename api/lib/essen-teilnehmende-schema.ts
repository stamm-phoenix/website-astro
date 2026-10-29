/**
 * Schemas of the forms for groups and participants of a Planung (`essen-teilnehmende-validation.ts`
 * parses with them). Errors are reported per field, with the messages the forms show.
 */
import { z } from 'zod';
import {
  ERNAEHRUNGEN,
  GRUPPEN_FAKTOR_FEHLER,
  gruppenFaktorGueltig,
  leseGruppenFaktor,
} from './essen-teilnehmende-model';
import { lenientObject } from './validation/zod';

const positiveId = (message: string) =>
  z.number({ error: message }).refine((id) => Number.isInteger(id) && id > 0, { error: message });

/** A limit of the stay: missing or null is the first or last meal. */
const grenze = z.preprocess(
  (value) => (value === undefined ? null : value),
  positiveId('Bitte eine Mahlzeit wählen.').nullable()
);

const ANZAHL_FEHLER = 'Bitte eine Anzahl von 1 bis 2000 eintragen.';
const LISTE_FEHLER = 'Bitte aus der Liste wählen.';

export const gruppeSchema = lenientObject({
  name: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z
      .string()
      .min(1, { error: 'Bitte einen Namen eintragen.' })
      .max(50, { error: 'Höchstens 50 Zeichen.' })
  ),
  faktor: z.preprocess(
    leseGruppenFaktor,
    z.number({ error: GRUPPEN_FAKTOR_FEHLER }).refine(gruppenFaktorGueltig, {
      error: GRUPPEN_FAKTOR_FEHLER,
    })
  ),
});

export const teilnehmendeSchema = lenientObject({
  gruppeId: positiveId('Bitte eine Gruppe wählen.'),
  ernaehrung: z.enum(ERNAEHRUNGEN as [string, ...string[]], {
    error: 'Bitte eine Ernährung wählen.',
  }),
  // Typed as text in the form; a number is taken as it is
  anzahl: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value.trim()) : value),
    z
      .number({ error: ANZAHL_FEHLER })
      .int({ error: ANZAHL_FEHLER })
      .min(1, { error: ANZAHL_FEHLER })
      .max(2000, { error: ANZAHL_FEHLER })
  ),
  unvertraeglichkeiten: z.preprocess(
    (value) => (value === undefined ? [] : value),
    z
      .array(positiveId(LISTE_FEHLER), { error: LISTE_FEHLER })
      .max(30, { error: LISTE_FEHLER })
      .transform((ids) => [...new Set(ids)].sort((a, b) => a - b))
  ),
  vonMahlzeitId: grenze,
  bisMahlzeitId: grenze,
  hinweis: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().max(200, { error: 'Höchstens 200 Zeichen.' })
  ),
});
