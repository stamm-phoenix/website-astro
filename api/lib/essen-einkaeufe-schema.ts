/**
 * Schemas of the shopping trips (`essen-einkaeufe-validation.ts` parses with them; the types are
 * declared in `essen-einkaeufe-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import { MAX_MENGE } from './essen-einkauf-model';
import { EINKAUF_REGEL_ARTEN } from './essen-einkaeufe-model';
import type {
  EinkaufInput,
  EinkaufRegelArt,
  HakenInput,
  RegelInput,
  VerschiebenInput,
  ZurueckholenInput,
} from './essen-einkaeufe-model';
import { einheitFeld, einheitPflicht } from './essen-einheit-schema';
import { readDatum } from './essen-planung-datum';
import { lenientObject } from './validation/zod';

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

/** A trimmed text of one line up to `max` characters; anything but a string is empty. */
function zeile(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

/** An optional ID: missing, null or '' is null; anything else must be a positive integer. */
function optionaleId(error: string) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? null : value),
    z
      .number({ error })
      .refine((value) => Number.isInteger(value) && value > 0, { error })
      .nullable()
  );
}

const zutatId = z
  .number({ error: 'Diese Zutat gibt es nicht.' })
  .refine((value) => Number.isInteger(value) && value > 0, { error: 'Diese Zutat gibt es nicht.' });

const DATUM_FEHLER = 'Bitte ein Datum wählen oder das Feld leer lassen.';

export const einkaufSchema = lenientObject({
  name: zeile(80).refine((value) => value.length > 0, { error: 'Bitte einen Namen eintragen.' }),
  datum: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? null : value),
    z
      .string({ error: DATUM_FEHLER })
      .refine((value) => readDatum(value) !== undefined, { error: DATUM_FEHLER })
      .nullable()
  ),
  geschaeftId: optionaleId('Bitte ein Geschäft wählen.'),
  bisMahlzeitId: optionaleId('Bitte eine Mahlzeit wählen.'),
  abgeschlossen: z.preprocess(
    (value) => value ?? false,
    z.boolean({ error: 'Bitte angeben, ob der Einkauf abgeschlossen ist.' })
  ),
}).transform((value): EinkaufInput => value);

const ERHALTEN_FEHLER = 'Bitte eine Menge ab 0 eintragen, z. B. 2,5.';

/** A stored amount: at least 0, three decimals, a tiny one stays a little. */
function menge(error: string) {
  return z
    .number({ error })
    .refine((value) => Number.isFinite(value) && value >= 0, { error })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    .transform((value) => (value === 0 ? 0 : Math.round(value * 1000) / 1000 || 0.001));
}

export const hakenSchema = lenientObject({
  planungZutatId: zutatId,
  einheit: einheitPflicht,
  erhalten: z.preprocess((value) => value ?? 0, menge(ERHALTEN_FEHLER)),
  ersatz: zeile(100),
}).transform((value): HakenInput => value);

const FEST_FEHLER = 'Bitte eine feste Menge ab 0 eintragen, z. B. 2,5.';

export const regelSchema = lenientObject({
  planungZutatId: zutatId,
  art: z.preprocess(
    (value) => value ?? null,
    z
      .enum(EINKAUF_REGEL_ARTEN as [EinkaufRegelArt, ...EinkaufRegelArt[]], {
        error: 'Bitte wählen, was mit der Zutat in diesem Einkauf passiert.',
      })
      .nullable()
  ),
  menge: z.preprocess(
    (value) => (value === undefined || value === '' ? null : value),
    menge(FEST_FEHLER).nullable()
  ),
  einheit: einheitFeld,
})
  .refine((value) => value.art !== 'fest' || value.menge !== null, {
    error: FEST_FEHLER,
    path: ['menge'],
    when: ALWAYS,
  })
  .refine((value) => value.art !== 'fest' || value.einheit !== null, {
    error: 'Bitte eine Einheit wählen.',
    path: ['einheit'],
    when: ALWAYS,
  })
  // Only a fixed amount keeps one
  .transform((value): RegelInput =>
    value.art === 'fest'
      ? value
      : { planungZutatId: value.planungZutatId, art: value.art, menge: null, einheit: null }
  );

export const verschiebenSchema = lenientObject({
  planungZutatId: zutatId,
  nachEinkaufId: z
    .number({ error: 'Bitte einen Einkauf wählen.' })
    .refine((value) => Number.isInteger(value) && value > 0, {
      error: 'Bitte einen Einkauf wählen.',
    }),
}).transform((value): VerschiebenInput => value);

export const zurueckholenSchema = lenientObject({
  planungZutatId: zutatId,
}).transform((value): ZurueckholenInput => value);
