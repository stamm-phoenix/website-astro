/**
 * Schemas of the forms of dishes and their ingredients (`essen-gerichte-validation.ts` parses with
 * them; the types are declared in `essen-gerichte-model.ts`). Errors are reported per field, with
 * the messages the forms show.
 */
import { z } from 'zod';
import type { EssenEinheitenart } from './essen-validation';
import { EINHEITEN_JE_ART, MAX_LINKS, MAX_WERKZEUGE } from './essen-gerichte-model';
import { einheitFeld } from './essen-einheit-schema';
import type { FieldOf } from './validation/zod';
import { lenientObject } from './validation/zod';

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

const MAX_MENGE = 1_000_000;
const MAX_IDS = 30;

const ARTEN = Object.keys(EINHEITEN_JE_ART) as [EssenEinheitenart, ...EssenEinheitenart[]];

const LISTE = 'Bitte aus der Liste wählen.';

/** A positive whole number, or null. */
function readId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** An ID as a field reads it: anything but a positive whole number is `null`. */
const id = z.preprocess(readId, z.number().nullable());

/** A text of one line: trimmed, whitespace collapsed; anything but a string is empty. */
function line(max: number, error = `Höchstens ${max} Zeichen.`) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().refine((value) => value.length <= max, { error })
  );
}

/** A trimmed text that keeps its line breaks; anything but a string is empty. */
function block(max: number, error: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().refine((value) => value.length <= max, { error })
  );
}

/** A list of at most 30 IDs, sorted and without duplicates; a missing one is empty. */
const ids = z.preprocess(
  (value) => (value === undefined ? [] : value),
  z
    .array(
      z.number({ error: LISTE }).refine((value) => readId(value) !== null, { error: LISTE }),
      { error: LISTE }
    )
    .refine((values) => values.length <= MAX_IDS, { error: LISTE })
    .transform((values) => [...new Set(values)].sort((a, b) => a - b))
);

/** The IDs of a list that passed; an invalid or missing list counts as empty. */
function validIds(value: unknown): number[] {
  const valid =
    Array.isArray(value) && value.length <= MAX_IDS && value.every((id) => readId(id) !== null);
  return valid ? (value as number[]) : [];
}

/** The field of a form error: the path, but a link reports per link and part. */
export const gerichtFieldOf: FieldOf = (path) => {
  const [first, index, part] = path;
  if (first === 'links' && typeof index === 'number' && typeof part === 'string') {
    return `links.${index}.${part}`;
  }
  return typeof first === 'string' ? first : 'form';
};

const URL_INVALID = 'Bitte eine Adresse wie https://beispiel.de eintragen.';

/** An http or https address of at most 500 characters. */
function isUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && value.length <= 500;
  } catch {
    return false;
  }
}

const link = lenientObject({
  titel: line(100),
  url: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string({ error: URL_INVALID }).refine(isUrl, { error: URL_INVALID })
  ),
});

const links = z
  .array(z.unknown(), { error: `Höchstens ${MAX_LINKS} Links.` })
  .refine((values) => values.length <= MAX_LINKS, { error: `Höchstens ${MAX_LINKS} Links.` })
  .pipe(z.array(link));

const werkzeuge = z
  .array(z.unknown(), { error: `Höchstens ${MAX_WERKZEUGE} Werkzeuge.` })
  .refine((values) => values.length <= MAX_WERKZEUGE, {
    error: `Höchstens ${MAX_WERKZEUGE} Werkzeuge.`,
  })
  .pipe(z.array(line(100)))
  .transform((names) =>
    names.reduce<string[]>((result, name) => {
      if (name && !result.some((other) => other.toLowerCase() === name.toLowerCase())) {
        result.push(name);
      }
      return result;
    }, [])
  );

const name = line(150).refine((value) => value !== '', {
  error: 'Bitte einen Namen eintragen, z. B. „Chili sin Carne“.',
});

const PERSONEN_UNGUELTIG = 'Bitte eine ganze Zahl ab 1 eintragen.';

/** The people the amounts are for; empty (`null` or `''`) is none yet. */
const personen = z.preprocess(
  (value) => (value === '' ? null : value),
  z
    .number({ error: PERSONEN_UNGUELTIG })
    .refine(Number.isInteger, { error: PERSONEN_UNGUELTIG })
    .refine((value) => value >= 1, { error: PERSONEN_UNGUELTIG })
    .refine((value) => value <= 2000, { error: 'Höchstens 2000 Personen.' })
    .nullable()
);

const anleitung = block(20_000, 'Höchstens 20.000 Zeichen.');
const notiz = block(1000, 'Höchstens 1000 Zeichen.');

/** Drops the optional fields that were not sent. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/** A new dish: only the name is needed; without people the amounts wait. */
export const gerichtNeuSchema = lenientObject({
  name,
  personen: personen.optional().transform((value) => value ?? null),
  anleitung: anleitung.optional(),
  notiz: notiz.optional(),
  links: links.optional(),
  werkzeuge: werkzeuge.optional(),
}).transform(withoutUndefined);

/** The fields of a dish that were sent; at least one. */
export const gerichtAenderungSchema = lenientObject({
  name: name.optional(),
  personen: personen.optional(),
  anleitung: anleitung.optional(),
  notiz: notiz.optional(),
  links: links.optional(),
  werkzeuge: werkzeuge.optional(),
})
  .transform(withoutUndefined)
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Es gibt nichts zu speichern.',
    path: ['name'],
  });

/** An optional amount: empty is `null`, otherwise a positive number up to a million. */
const menge = z.preprocess(
  (value) => (value === null || value === undefined || value === '' ? null : value),
  z
    .number({ error: 'Bitte eine Menge größer als 0 eintragen oder leer lassen.' })
    .refine((value) => Number.isFinite(value), {
      error: 'Bitte eine Menge größer als 0 eintragen oder leer lassen.',
    })
    .refine((value) => value > 0, {
      error: 'Bitte eine Menge größer als 0 eintragen oder leer lassen.',
    })
    .refine((value) => value <= MAX_MENGE, { error: 'Die Menge ist zu groß.' })
    .transform((value) => Math.round(value * 1000) / 1000 || 0.001)
    .nullable()
);

/** The unit, known or typed; a missing one is `null` and reported with the amount. */
const einheit = einheitFeld;

/** Whether the flag is not `false`: the line applies unless it says otherwise. */
const unlessFalse = z.preprocess((value) => value !== false, z.boolean());

export const gerichtZutatSchema = lenientObject({
  zutatId: id,
  planungZutatId: id,
  menge,
  einheit,
  fest: z.preprocess((value) => value === true, z.boolean()),
  fuerAlles: unlessFalse,
  fuerVegetarisch: unlessFalse,
  fuerVegan: unlessFalse,
  ohne: ids,
  nur: ids,
  hinweis: line(100),
})
  .refine((value) => value.zutatId !== null || value.planungZutatId !== null, {
    error: 'Bitte eine Zutat wählen.',
    path: ['zutat'],
    when: ALWAYS,
  })
  .refine((value) => value.menge === null || value.einheit !== null, {
    error: 'Bitte eine Einheit wählen.',
    path: ['einheit'],
    when: ALWAYS,
  })
  .refine((value) => value.fuerAlles || value.fuerVegetarisch || value.fuerVegan, {
    error: 'Die Zeile muss für mindestens eine Ernährungsform gelten.',
    path: ['fuer'],
    when: ALWAYS,
  })
  .refine((value) => !validIds(value.ohne).some((other) => validIds(value.nur).includes(other)), {
    error: 'Eine Unverträglichkeit kann nicht zugleich „nicht für“ und „nur für“ sein.',
    path: ['nur'],
    when: ALWAYS,
  })
  .transform((value) => ({
    zutat: value.zutatId ? { zutatId: value.zutatId } : { planungZutatId: value.planungZutatId! },
    menge: value.menge,
    einheit: value.menge === null ? null : value.einheit,
    fest: value.fest && value.menge !== null,
    fuerAlles: value.fuerAlles,
    fuerVegetarisch: value.fuerVegetarisch,
    fuerVegan: value.fuerVegan,
    ohne: value.ohne,
    nur: value.nur,
    hinweis: value.hinweis,
  }));

const einheitenart = z.preprocess(
  (value) => (ARTEN.some((art) => art === value) ? value : null),
  z.enum(ARTEN).nullable()
);

/** The differences of a central ingredient in a Planung; nothing is refused. */
export const planungZutatAbweichungSchema = lenientObject({
  kategorieId: id,
  einheitenart,
});

const merkmal = z.preprocess(
  (value) => (typeof value === 'boolean' ? value : null),
  z.boolean().nullable()
);

/** An ingredient of the Planung's own. */
export const planungZutatEigeneSchema = lenientObject({
  name: line(150).refine((value) => value !== '', { error: 'Bitte einen Namen eintragen.' }),
  kategorieId: id.refine((value) => value !== null, { error: 'Bitte eine Kategorie wählen.' }),
  einheitenart: einheitenart.refine((value) => value !== null, {
    error: 'Bitte wählen, worin die Zutat gemessen wird.',
  }),
  vegetarisch: merkmal,
  vegan: merkmal,
  allergene: ids,
}).transform((value) => ({
  ...value,
  // Vegan includes vegetarian, as in the central list
  vegetarisch: value.vegan ? true : value.vegetarisch,
}));
