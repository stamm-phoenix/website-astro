/**
 * Answers of the Leitenden to a Schnupperstunden-Anfrage (#139): confirming a date or
 * cancelling. The request of a family is checked by `validateSchnupperAnfrage`
 * (`schnupper-model.ts`), because the browser runs that check too.
 */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { berlinDay } from '../calendar-day';
import { SCHNUPPER_MAX_LENGTH, isSchnupperStufe } from '../schnupper-model';
import type { SchnupperAbsage, SchnupperBestaetigung, SchnupperStufe } from '../schnupper-model';
import { labeledText, lenientObject, parseWith } from './zod';

/** Text to the family: trimmed, line breaks kept, a missing value is `''`. */
const antwort = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : value),
  z
    .string({ error: 'Die Nachricht an die Familie ist ungültig.' })
    .max(SCHNUPPER_MAX_LENGTH.antwort, {
      error: `Die Nachricht an die Familie darf höchstens ${SCHNUPPER_MAX_LENGTH.antwort} Zeichen lang sein.`,
    })
);

/** A confirmed date: today or later in Berlin, with a time, the Stufe and an optional place. */
export function schnupperBestaetigungSchema(today: string = berlinDay()) {
  return lenientObject({
    stufe: z.custom<SchnupperStufe>(isSchnupperStufe, {
      error: 'Bitte die Stufe auswählen.',
    }),
    datum: z
      .string({ error: 'Bitte ein Datum angeben.' })
      .refine(isValidDate, { error: 'Bitte ein gültiges Datum angeben.' })
      .refine((value) => value >= today, { error: 'Das Datum liegt in der Vergangenheit.' }),
    zeit: z
      .string({ error: 'Bitte eine Uhrzeit angeben.' })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Bitte eine Uhrzeit wie 17:00 angeben.' }),
    ort: labeledText('den Treffpunkt', SCHNUPPER_MAX_LENGTH.ort),
    antwort,
  });
}

const absageSchema = lenientObject({ antwort });

/** Reads the confirmation of a date, or throws a `ValidationError` keyed by field. */
export function validateSchnupperBestaetigung(
  body: unknown,
  today?: string
): SchnupperBestaetigung {
  return parseWith(schnupperBestaetigungSchema(today), body);
}

/** Reads a cancellation, or throws a `ValidationError` keyed by field. */
export function validateSchnupperAbsage(body: unknown): SchnupperAbsage {
  return parseWith(absageSchema, body);
}
