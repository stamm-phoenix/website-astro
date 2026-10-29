/**
 * Schemas of the forms for shops, stock and extra needs (`essen-einkauf-validation.ts` parses with
 * them; the types are declared in `essen-einkauf-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import { MAX_MENGE, MENGE_FEHLER } from './essen-einkauf-model';
import { EINHEITEN_JE_ART } from './essen-gerichte-model';
import type { GerichtEinheit } from './essen-gerichte-model';
import { lenientObject } from './validation/zod';

const EINHEITEN = Object.values(EINHEITEN_JE_ART).flat() as [GerichtEinheit, ...GerichtEinheit[]];

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

const id = z.preprocess(
  (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null),
  z.number().nullable()
);

/** A trimmed text of one line up to `max` characters; anything but a string is empty. */
function zeile(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

export const geschaeftSchema = lenientObject({
  name: zeile(80).refine((value) => value.length > 0, { error: 'Bitte einen Namen eintragen.' }),
});

export const postenSchema = lenientObject({
  zutatId: id,
  planungZutatId: id,
  menge: z
    .number({ error: MENGE_FEHLER })
    .refine((value) => Number.isFinite(value) && value > 0, { error: MENGE_FEHLER })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    .transform((value) => Math.round(value * 1000) / 1000 || 0.001),
  einheit: z.enum(EINHEITEN, { error: 'Bitte eine Einheit wählen.' }),
  hinweis: zeile(200),
})
  .refine((value) => value.zutatId !== null || value.planungZutatId !== null, {
    error: 'Bitte eine Zutat wählen.',
    path: ['zutat'],
    when: ALWAYS,
  })
  .transform((value) => ({
    zutat: value.zutatId ? { zutatId: value.zutatId } : { planungZutatId: value.planungZutatId! },
    menge: value.menge,
    einheit: value.einheit,
    hinweis: value.hinweis,
  }));

/** Which shop an ingredient of the Planung is bought at; null: none. */
export const zutatGeschaeftSchema = lenientObject({
  geschaeftId: z.preprocess(
    (value) => (value === undefined ? null : value),
    z
      .number({ error: 'Bitte ein Geschäft wählen.' })
      .refine((value) => Number.isInteger(value) && value > 0, {
        error: 'Bitte ein Geschäft wählen.',
      })
      .nullable()
  ),
});
