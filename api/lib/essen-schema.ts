/**
 * Schemas of the Steuerung of the Essensplanung (`essen-validation.ts` parses with them). Errors
 * are reported per field; the keys of list entries carry the index, e.g. `whitelist.1`.
 */
import { MAX_MAHLZEITEN_PRO_TAG } from './essen-planung-model';
import { z } from 'zod';
import { isRecord } from './validation/zod';

/** masse: g/kg, volumen: ml/l; Stück, Packung und Bund werden nur gezählt. */
export const EINHEITENARTEN = ['masse', 'volumen', 'stueck', 'packung', 'bund'] as const;

export type EssenEinheitenart = (typeof EINHEITENARTEN)[number];

export const COLLATOR = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

/** Rounds to the two decimals the columns store. */
function centi(value: number): number {
  return Math.round(value * 100) / 100;
}

/** An object schema that reads anything but an object as `{}`, so the missing fields report. */
function lenient<S extends z.ZodType>(schema: S) {
  return z.preprocess((value) => (isRecord(value) ? value : {}), schema);
}

const YES_NO = 'Bitte ja oder nein wählen.';
const flag = z.boolean({ error: YES_NO });

/** A trimmed text of at most `max` characters; anything but a string counts as empty. */
function name(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z
      .string()
      .min(1, { error: 'Bitte einen Namen eintragen.' })
      .max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

function positiveInteger(error: string) {
  return z.number({ error }).refine((value) => Number.isInteger(value) && value > 0, { error });
}

/** A number from 0,01 to `max` (after rounding to two decimals), or null for an empty field. */
function gramm(max: number) {
  const error = `Bitte eine Zahl von 0,01 bis ${max.toLocaleString('de-DE')} eintragen oder das Feld leer lassen.`;
  return z.preprocess(
    (value) => (value === undefined || value === '' ? null : value),
    z
      .number({ error })
      .transform(centi)
      .pipe(z.number({ error }).min(0.01, { error }).max(max, { error }))
      .nullable()
  );
}

/** Index of the first name that an earlier one already has, or -1. */
function firstDuplicate(names: readonly string[]): number {
  return names.findIndex(
    (entry, index) => names.findIndex((other) => COLLATOR.compare(other, entry) === 0) !== index
  );
}

/**
 * A list of 1 to `max` entries; the entries are only checked when the list itself is fine. The
 * check for duplicates also runs when entries are invalid, so every field reports.
 */
function entries<S extends z.ZodType>(
  max: number,
  entry: S,
  nameOf: (item: z.output<S>) => string,
  path: (index: number) => (string | number)[],
  messages: { empty: string; many: string; duplicate: string }
) {
  return z
    .array(z.unknown(), { error: messages.empty })
    .min(1, { error: messages.empty })
    .max(max, { error: messages.many })
    .pipe(
      z.array(entry).superRefine(
        (items, ctx) => {
          const duplicate = firstDuplicate(items.map(nameOf));
          if (duplicate >= 0) {
            ctx.addIssue({ code: 'custom', path: path(duplicate), message: messages.duplicate });
          }
        },
        { when: ALWAYS }
      )
    );
}

const vorlageGruppe = lenient(
  z.object({
    name: name(50),
    faktor: z
      .number({ error: 'Bitte einen Faktor von 0,01 bis 5 eintragen.' })
      .transform(centi)
      .pipe(
        z
          .number()
          .min(0.01, { error: 'Bitte einen Faktor von 0,01 bis 5 eintragen.' })
          .max(5, { error: 'Bitte einen Faktor von 0,01 bis 5 eintragen.' })
      ),
  })
);

const whitelistEintrag = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : ''),
  z.string().refine((text) => !text || EMAIL.test(text) || DOMAIN.test(text), {
    error: 'Bitte eine Mailadresse (name@beispiel.de) oder eine Domain (beispiel.de) eintragen.',
  })
);

const MONATE = 'Bitte eine ganze Zahl von 1 bis 120 Monaten eintragen.';

export const einstellungenSchema = lenient(
  z.object({
    anlegenExtern: flag,
    whitelist: z
      .array(whitelistEintrag, { error: 'Bitte eine Liste angeben.' })
      .transform((list) => [...new Set(list.filter(Boolean))]),
    aufbewahrungMonate: z
      .number({ error: MONATE })
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 120, { error: MONATE }),
    wartung: flag,
    vorlageGruppen: entries(
      20,
      vorlageGruppe,
      (gruppe) => gruppe.name,
      (index) => [index, 'name'],
      {
        empty: 'Bitte mindestens eine Gruppe eintragen.',
        many: 'Höchstens 20 Gruppen.',
        duplicate: 'Diese Gruppe gibt es schon.',
      }
    ),
    vorlageMahlzeiten: entries(
      MAX_MAHLZEITEN_PRO_TAG,
      name(50),
      (mahlzeit) => mahlzeit,
      (index) => [index],
      {
        empty: 'Bitte mindestens eine Mahlzeit eintragen.',
        many: `Höchstens ${MAX_MAHLZEITEN_PRO_TAG} Mahlzeiten.`,
        duplicate: 'Diese Mahlzeit gibt es schon.',
      }
    ),
  })
);

const MERKMAL = 'Bitte ja, nein oder unbekannt wählen.';

/** Vegetarian or vegan: yes, no, or null while it is not known. */
const merkmal = z.preprocess(
  (value) => (value === undefined ? null : value),
  z.boolean({ error: MERKMAL }).nullable()
);

export const zutatSchema = lenient(
  z
    .object({
      name: name(150),
      kategorieId: positiveInteger('Bitte eine Kategorie wählen.'),
      einheitenart: z.enum(EINHEITENARTEN, { error: 'Bitte eine Einheit wählen.' }),
      abtropfgewicht: flag,
      lebensmittel: flag,
      vegetarisch: merkmal,
      vegan: merkmal,
      merkmaleGeprueft: flag,
      hinweis: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim() : ''),
        z.string().max(200, { error: 'Höchstens 200 Zeichen.' })
      ),
      grammProTl: gramm(1000),
      grammProEl: gramm(1000),
      grammProStueck: gramm(100_000),
      /** IDs of `essen.unvertraeglichkeit`; a repeated one is as invalid as a wrong one. */
      allergene: z
        .array(positiveInteger('Ungültige Auswahl.'), { error: 'Bitte eine Liste angeben.' })
        .refine((ids) => new Set(ids).size === ids.length, { error: 'Ungültige Auswahl.' }),
    })
    .superRefine(
      (zutat, ctx) => {
        if (zutat.abtropfgewicht === true && zutat.einheitenart !== 'masse') {
          ctx.addIssue({
            code: 'custom',
            path: ['abtropfgewicht'],
            message: 'Abtropfgewicht gibt es nur bei Gewicht (g/kg).',
          });
        }
        if (zutat.vegan === true && zutat.vegetarisch !== true) {
          ctx.addIssue({
            code: 'custom',
            path: ['vegan'],
            message: 'Was vegan ist, ist auch vegetarisch.',
          });
        }
      },
      { when: ALWAYS }
    )
    .transform((zutat) =>
      // Things that are not eaten have no diet and no allergens
      zutat.lebensmittel ? zutat : { ...zutat, vegetarisch: null, vegan: null, allergene: [] }
    )
);

export const listNameSchema = lenient(z.object({ name: name(100) }));

export type EssenEinstellungen = z.output<typeof einstellungenSchema>;
export type VorlageGruppe = EssenEinstellungen['vorlageGruppen'][number];
export type ZutatInput = z.output<typeof zutatSchema>;
