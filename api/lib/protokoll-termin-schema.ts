/**
 * Schemas of the next Leitendenrunde: the stored value (read leniently, every unreadable field
 * falls back to its safe value), the answer of the model (nothing of it is trusted blindly)
 * and the date a leader confirms (strict, with a message per field).
 */
import { z } from 'zod';
import { isValidDate } from './calendar-date';
import type { ConfirmedTermin, ProtokollTermin } from './protokoll-termin';
import { lenientObject } from './validation/zod';

export const TERMIN_EXTRACTIONS = [
  'gefunden',
  'unklar',
  'nicht gefunden',
  'fehler',
  'nicht eingerichtet',
  'nicht ausgefuehrt',
] as const;

export const TERMIN_DECISIONS = ['offen', 'bestaetigt', 'abgelehnt'] as const;

export const MAX_PLACE_LENGTH = 120;
export const MAX_QUOTE_LENGTH = 300;

// --- Building blocks ----------------------------------------------------------------------

/** A real calendar date as `YYYY-MM-DD`. */
const calendarDate = z.string().refine(isValidDate, { abort: true });

/** `H:MM` or `HH:MM` within a day. */
const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** `H:MM` or `HH:MM` within a day as `HH:MM`, otherwise null. */
const lenientTime = z
  .string()
  .trim()
  .regex(TIME_PATTERN)
  .transform((time) => time.padStart(5, '0'))
  .nullable()
  .catch(null);

/** Text on one line, trimmed, cut to `max`; null if it is no text or empty. */
export function lenientText(max: number) {
  return z
    .string()
    .transform((text) => text.replace(/\s+/g, ' ').trim().slice(0, max) || null)
    .nullable()
    .catch(null);
}

const lenientString = z.string().catch('');
const lenientTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .catch('');

// --- Stored value -------------------------------------------------------------------------

const storedConfirmed = lenientObject({
  date: calendarDate,
  time: lenientTime,
  place: lenientText(MAX_PLACE_LENGTH),
})
  .nullable()
  .catch(null);

const storedSuggestion = lenientObject({
  date: calendarDate.nullable().catch(null),
  time: lenientTime,
  place: lenientText(MAX_PLACE_LENGTH),
  quote: lenientText(MAX_QUOTE_LENGTH),
});

/**
 * The stored `Termin`: single unreadable fields fall back to the safe value, and a confirmation
 * without a valid date counts as open. Anything but an object is rejected.
 */
export const storedTerminSchema = z
  .object({
    sourceVersion: lenientString,
    extraction: z.enum(TERMIN_EXTRACTIONS).catch('fehler'),
    suggestion: storedSuggestion,
    decision: z.enum(TERMIN_DECISIONS).catch('offen'),
    confirmed: storedConfirmed,
    decidedBy: lenientString,
    decidedAt: lenientTimestamp,
    extractedAt: lenientTimestamp,
  })
  .transform((stored): ProtokollTermin => {
    const decision =
      stored.decision === 'bestaetigt' && !stored.confirmed ? 'offen' : stored.decision;
    return { ...stored, decision, confirmed: decision === 'bestaetigt' ? stored.confirmed : null };
  });

// --- Answer of the model ------------------------------------------------------------------

/** Days from `isoDate`, as `YYYY-MM-DD`. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** For comparing a quote with the text: one line, lower case, plain quotes and dashes. */
function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[„“”‚‘’«»"']/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('de');
}

/**
 * The answer of the model: a date outside the window after the session, a quote that is not in
 * the text and anything of the wrong type become null; the status falls back to „unklar“.
 */
export function modelAnswerSchema(
  context: { sessionDate: string; text: string },
  maxDaysAhead: number
) {
  return z
    .object({
      status: z.enum(['gefunden', 'unklar', 'nicht gefunden']).catch('unklar'),
      date: calendarDate.nullable().catch(null),
      time: lenientTime,
      place: lenientText(MAX_PLACE_LENGTH),
      quote: lenientText(MAX_QUOTE_LENGTH),
    })
    .transform((answer) => {
      // „nicht gefunden“ carries no suggestion, so the window and the text are not looked at
      if (answer.status === 'nicht gefunden') return answer;
      const inWindow =
        answer.date !== null &&
        answer.date > context.sessionDate &&
        answer.date <= addDays(context.sessionDate, maxDaysAhead);
      const quoted =
        answer.quote !== null &&
        answer.quote.length >= 4 &&
        normalizeForSearch(context.text).includes(normalizeForSearch(answer.quote));
      return {
        ...answer,
        date: inWindow ? answer.date : null,
        quote: quoted ? answer.quote : null,
      };
    });
}

// --- Confirmation of a leader -------------------------------------------------------------

const DATE_ERROR = 'Bitte ein gültiges Datum angeben.';
const TIME_ERROR = 'Bitte die Uhrzeit als HH:MM angeben.';

/**
 * The date, time and place a leader confirms. The date must be real and not before the
 * session (`sessionDate` may be empty); time and place are optional and become null when empty.
 */
export function confirmedTerminSchema(sessionDate: string) {
  return z.object({
    date: z
      .string({ error: DATE_ERROR })
      .trim()
      .refine(isValidDate, { error: DATE_ERROR, abort: true })
      .refine((date) => !sessionDate || date >= sessionDate, {
        error: 'Der nächste Termin kann nicht vor der Sitzung liegen.',
      }),
    time: z.preprocess(
      (value) => value ?? '',
      z
        .string({ error: TIME_ERROR })
        .trim()
        .refine((time) => time === '' || TIME_PATTERN.test(time), { error: TIME_ERROR })
        .transform((time) => (time ? time.padStart(5, '0') : null))
    ),
    place: z.preprocess(
      (value) => value ?? '',
      z
        .string({ error: 'Bitte den Ort als Text angeben.' })
        .overwrite((place) => place.replace(/\s+/g, ' ').trim())
        .refine((place) => place.length <= MAX_PLACE_LENGTH, {
          error: `Bitte höchstens ${MAX_PLACE_LENGTH} Zeichen angeben.`,
        })
        .transform((place) => place || null)
    ),
  }) satisfies z.ZodType<ConfirmedTermin, unknown>;
}
