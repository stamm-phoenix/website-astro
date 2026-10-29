/**
 * Schemas of the forms for shops, stock and extra needs (`essen-einkauf-validation.ts` parses with
 * them; the types are declared in `essen-einkauf-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import { MAX_MENGE, MENGE_FEHLER } from './essen-einkauf-model';
import type { PostenArt, PostenInput } from './essen-einkauf-model';
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

const menge = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? null : value),
  z
    .number({ error: MENGE_FEHLER })
    .refine((value) => Number.isFinite(value) && value > 0, { error: MENGE_FEHLER })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    .transform((value) => Math.round(value * 1000) / 1000 || 0.001)
    .nullable()
);

/**
 * A row of the stock or of the extra needs. Extra needs may go without an amount and name a thing
 * that is not in the list („Kochhandschuhe“); the stock always has an ingredient and an amount.
 */
export function postenSchema(art: PostenArt) {
  return lenientObject({
    zutatId: id,
    planungZutatId: id,
    name: zeile(150),
    menge,
    einheit: z.preprocess(
      (value) => (value === undefined || value === '' ? null : value),
      z.enum(EINHEITEN, { error: 'Bitte eine Einheit wählen.' }).nullable()
    ),
    hinweis: zeile(200),
  })
    .refine(
      (value) =>
        value.zutatId !== null ||
        value.planungZutatId !== null ||
        (art === 'zusatzbedarf' && value.name !== ''),
      {
        error:
          art === 'zusatzbedarf'
            ? 'Bitte eine Zutat wählen oder eintragen, was gebraucht wird.'
            : 'Bitte eine Zutat wählen.',
        path: ['zutat'],
        when: ALWAYS,
      }
    )
    .refine((value) => value.menge !== null || art === 'zusatzbedarf', {
      error: MENGE_FEHLER,
      path: ['menge'],
      when: ALWAYS,
    })
    .refine((value) => value.menge === null || value.einheit !== null, {
      error: 'Bitte eine Einheit wählen.',
      path: ['einheit'],
      when: ALWAYS,
    })
    .transform((value): PostenInput => ({
      zutat: value.zutatId
        ? { zutatId: value.zutatId }
        : value.planungZutatId
          ? { planungZutatId: value.planungZutatId }
          : { name: value.name },
      menge: value.menge,
      einheit: value.menge === null ? null : value.einheit,
      hinweis: value.hinweis,
    }));
}

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
