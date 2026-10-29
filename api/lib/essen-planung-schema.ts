/**
 * Schemas of the forms of a Planung of the Essensplanung (`essen-planung-model.ts` parses with
 * them). Errors are reported per field, with the messages the forms show.
 */
import { z } from 'zod';
import { MAX_TAGE, daysBetween, readDatum } from './essen-planung-datum';
import { FAKTOR_FEHLER, faktorGueltig, leseFaktor } from './essen-planung-faktor';
import { isRecord, lenientObject } from './validation/zod';

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAIL_INVALID = 'Bitte eine gültige Mailadresse eintragen, z. B. name@beispiel.de.';
const TIME_INVALID = 'Bitte eine Uhrzeit wie 12:30 eintragen.';

/** A trimmed text of 1 to `max` characters; anything but a string counts as empty. */
function text(max: number, missing: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z
      .string({ error: missing })
      .min(1, { error: missing })
      .max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

/** A lower-cased address that may be empty; `required` makes an empty one an error. */
function address(required: boolean) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
    z
      .string({ error: MAIL_INVALID })
      .min(required ? 1 : 0, { error: 'Bitte eine Mailadresse eintragen.' })
      .max(254, { error: MAIL_INVALID })
      .refine((value) => value === '' || EMAIL.test(value), { error: MAIL_INVALID })
  );
}

/** A required address. */
const email = address(true);

/** An address that may be left out; then it is `null`. */
const optionalEmail = address(false).transform((value) => value || null);

/** A calendar date `YYYY-MM-DD`. */
function datum(error: string) {
  return z.string({ error }).refine((value) => readDatum(value) !== undefined, { error });
}

/** Days from the first to the last day, counting both; 1 while a date is not valid. */
function tage(value: { ersterTag: unknown; letzterTag: unknown }): number {
  const erster = readDatum(value.ersterTag);
  const letzter = readDatum(value.letzterTag);
  return erster && letzter ? daysBetween(erster, letzter) + 1 : 1;
}

export const anlegenSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      email,
      name: text(100, 'Bitte deinen Namen eintragen.'),
      planungName: text(
        150,
        'Bitte einen Namen für die Planung eintragen, z. B. „Sommerlager 2027“.'
      ),
      ersterTag: datum('Bitte den ersten Tag wählen.'),
      letzterTag: datum('Bitte den letzten Tag wählen.'),
    })
    .refine((value) => tage(value) >= 1, {
      error: 'Der letzte Tag liegt vor dem ersten.',
      path: ['letzterTag'],
      when: ALWAYS,
    })
    .refine((value) => tage(value) <= MAX_TAGE, {
      error: `Höchstens ${MAX_TAGE} Tage.`,
      path: ['letzterTag'],
      when: ALWAYS,
    })
);

export const mitgliedNameSchema = lenientObject({
  name: text(100, 'Bitte einen Namen eintragen.'),
});

export const beitrittSchema = lenientObject({
  name: text(100, 'Bitte deinen Namen eintragen.'),
  email: optionalEmail,
});

export const einladungSchema = lenientObject({
  name: text(100, 'Bitte einen Namen eintragen.'),
  email,
  // Anything but the owner role is the editing role
  rolle: z.preprocess(
    (value) => (value === 'besitzer' ? 'besitzer' : 'bearbeiten'),
    z.enum(['besitzer', 'bearbeiten'])
  ),
});

export const emailSchema = lenientObject({ email });

export const tagSchema = lenientObject({ datum: datum('Bitte ein Datum wählen.') });

export const mahlzeitSchema = lenientObject({
  name: text(50, 'Bitte einen Namen eintragen.'),
  // Empty or no text is no time; only the first five characters count
  uhrzeit: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 5) : null),
    z.string({ error: TIME_INVALID }).regex(TIME, { error: TIME_INVALID }).nullable()
  ),
});

/**
 * Only the changed fields are sent, with what the form showed before: a field changed by someone
 * else meanwhile is a conflict, fields left alone keep what others saved. `vorher` is missing
 * when the client sent none; then the field is simply set.
 */
export const planungEinstellungenSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z
    .object({
      name: z.optional(text(150, 'Bitte einen Namen eintragen.')),
      mitgliederVerwalten: z.optional(z.boolean({ error: 'Bitte ja oder nein wählen.' })),
      vorher: lenientObject({
        name: z.optional(z.unknown()),
        mitgliederVerwalten: z.optional(z.unknown()),
      }),
    })
    .refine((value) => value.name !== undefined || value.mitgliederVerwalten !== undefined, {
      error: 'Es gibt nichts zu speichern.',
      path: ['name'],
    })
    .transform(({ name, mitgliederVerwalten, vorher }) => ({
      ...(name !== undefined
        ? {
            name: {
              neu: name,
              ...(typeof vorher.name === 'string' ? { vorher: vorher.name } : {}),
            },
          }
        : {}),
      ...(mitgliederVerwalten !== undefined
        ? {
            mitgliederVerwalten: {
              neu: mitgliederVerwalten,
              ...(typeof vorher.mitgliederVerwalten === 'boolean'
                ? { vorher: vorher.mitgliederVerwalten }
                : {}),
            },
          }
        : {}),
    }))
);

/** A position (1-based) for moving a meal within its day. */
export const positionSchema = z
  .number({ error: 'Bitte eine Position von 1 bis 100 wählen.' })
  .int({ error: 'Bitte eine Position von 1 bis 100 wählen.' })
  .min(1, { error: 'Bitte eine Position von 1 bis 100 wählen.' })
  .max(100, { error: 'Bitte eine Position von 1 bis 100 wählen.' });

const positiveId = (message: string) =>
  z.number({ error: message }).refine((id) => Number.isInteger(id) && id > 0, { error: message });

/** A dish at a meal, or moved or copied to one. */
export const einplanungSchema = lenientObject({
  mahlzeitId: positiveId('Bitte eine Mahlzeit wählen.'),
  gerichtId: positiveId('Bitte ein Gericht wählen.'),
  faktor: z.preprocess(
    (value) => (value === undefined ? 1 : leseFaktor(value)),
    z.number({ error: FAKTOR_FEHLER }).refine(faktorGueltig, { error: FAKTOR_FEHLER })
  ),
  zustaendigId: z.preprocess(
    (value) => (value === undefined ? null : value),
    positiveId('Bitte aus der Liste wählen.').nullable()
  ),
  zustaendigText: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string()
  ),
}).superRefine(
  ({ zustaendigId, zustaendigText }, ctx) => {
    // A member and a free name exclude each other; that message wins over the length.
    const message =
      zustaendigId != null && zustaendigText
        ? 'Entweder ein Mitglied oder einen Namen.'
        : zustaendigText.length > 100
          ? 'Höchstens 100 Zeichen.'
          : undefined;
    if (message) ctx.addIssue({ code: 'custom', path: ['zustaendigText'], message });
  },
  { when: ALWAYS }
);
