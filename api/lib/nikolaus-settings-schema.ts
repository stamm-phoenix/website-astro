/**
 * Validation of the form of the Steuerung (module „Steuerung“ of the Nikolausdienst). Errors are
 * reported per field with the path as the key (`days.0.start`, `area.base.name` …).
 */
import { z } from 'zod';
import type { NikolausDayConfig, NikolausSettings } from './nikolaus-config';
import { NIKOLAUS_SLOT_MINUTES, NIKOLAUS_TEAMS } from './nikolaus-config';
import { isRecord, parseWith } from './validation/zod';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 10;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/** Text that is trimmed; anything but a string counts as empty. */
const trimmed = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : ''),
  z.string()
);

/** An object schema that reads anything but an object as `{}`. */
function lenient<S extends z.ZodRawShape>(shape: S) {
  return z.preprocess((value) => (isRecord(value) ? value : {}), z.object(shape));
}

const flag = z.boolean({ error: 'Bitte auswählen.' });

function integer(min: number, max: number) {
  const error = `Bitte eine ganze Zahl von ${min} bis ${max} angeben.`;
  return z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
}

function decimal(min: number, max: number) {
  const error = `Bitte eine Zahl von ${min} bis ${max} angeben.`;
  return z.number({ error }).min(min, { error }).max(max, { error });
}

const TIME_MESSAGE = 'Bitte eine Uhrzeit (HH:MM) angeben.';
const time = z.string({ error: TIME_MESSAGE }).regex(TIME, { error: TIME_MESSAGE });

/** Reads a field of a value that may not have passed its own schema yet. */
function stringField(value: unknown, field: string): string {
  const text = isRecord(value) ? value[field] : undefined;
  return typeof text === 'string' ? text : '';
}

const daySchema = z
  .preprocess(
    (value) => (isRecord(value) ? value : {}),
    z.object({
      date: z
        .string({ error: 'Bitte ein gültiges Datum angeben.' })
        .refine(isRealDate, { error: 'Bitte ein gültiges Datum angeben.' }),
      start: time,
      end: time,
      teams: integer(1, NIKOLAUS_TEAMS.length),
    })
  )
  .superRefine(
    (day, ctx) => {
      // The raw input: the end is judged even if the date or the number of teams is invalid
      const start = stringField(day, 'start');
      const end = stringField(day, 'end');
      if (!TIME.test(start) || !TIME.test(end)) return;
      const length = minutes(end) - minutes(start);
      if (length < NIKOLAUS_SLOT_MINUTES) {
        ctx.addIssue({
          code: 'custom',
          path: ['end'],
          message: `Das Ende muss mindestens ${NIKOLAUS_SLOT_MINUTES} Minuten nach dem Beginn liegen.`,
        });
      } else if (length % NIKOLAUS_SLOT_MINUTES) {
        ctx.addIssue({
          code: 'custom',
          path: ['end'],
          message: `Die Zeit muss in Termine zu ${NIKOLAUS_SLOT_MINUTES} Minuten aufgehen.`,
        });
      }
    },
    { when: () => true }
  );

/** The days: at most `MAX_DAYS`, each date once. Over the limit the single days are not read. */
const daysSchema = z
  .array(z.unknown(), { error: 'Bitte die Besuchstage angeben.' })
  .max(MAX_DAYS, { error: `Höchstens ${MAX_DAYS} Besuchstage.` })
  .pipe(
    z
      .array(daySchema)
      .superRefine(
        (days, ctx) => {
          days.forEach((day, index) => {
            const date = stringField(day, 'date');
            if (days.findIndex((other) => stringField(other, 'date') === date) !== index) {
              ctx.addIssue({
                code: 'custom',
                path: [index, 'date'],
                message: 'Dieser Tag ist schon eingetragen.',
              });
            }
          });
        },
        { when: () => true }
      )
      .transform((days): NikolausDayConfig[] => days.sort((a, b) => a.date.localeCompare(b.date)))
  );

const POSTAL_CODES_MESSAGE = 'Bitte fünfstellige Postleitzahlen angeben.';

const areaSchema = lenient({
  base: lenient({
    name: trimmed.pipe(
      z
        .string()
        .min(1, { error: 'Bitte einen Namen angeben.' })
        .max(100, { error: 'Bitte einen Namen angeben.' })
    ),
    lat: decimal(-90, 90),
    lon: decimal(-180, 180),
  }),
  servicePostalCodes: z
    .array(trimmed, { error: POSTAL_CODES_MESSAGE })
    .min(1, { error: POSTAL_CODES_MESSAGE })
    .max(30, { error: POSTAL_CODES_MESSAGE })
    .refine((codes) => codes.every((code) => /^\d{5}$/.test(code)), { error: POSTAL_CODES_MESSAGE })
    .transform((codes) => [...new Set(codes)]),
  farDistanceKm: decimal(0.1, 1000),
});

/** Optional, but if anything is entered both name and phone are needed. */
const dayContactSchema = lenient({ name: trimmed, phone: trimmed })
  .superRefine((contact, ctx) => {
    if (!contact.name && !contact.phone) return;
    if (!contact.name || contact.name.length > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Bitte einen Namen mit höchstens 100 Zeichen angeben.',
      });
    }
    // Only digits and the usual separators, and enough digits for a working call link
    if (
      !/^\+?[\d ()/-]{6,30}$/.test(contact.phone) ||
      contact.phone.replace(/\D/g, '').length < 6
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Bitte eine Telefonnummer angeben, z. B. 0170 1234567.',
      });
    }
  })
  .transform((contact) => (contact.name || contact.phone ? contact : null));

const settingsSchema = lenient({
  publicActive: flag,
  staffActive: flag,
  maintenance: flag,
  pendingHoldMinutes: integer(5, 1440),
  changeDeadlineHours: integer(0, 336),
  days: daysSchema,
  area: areaSchema,
  dayContact: dayContactSchema,
}).superRefine(
  (settings, ctx) => {
    // Judged on what was sent, so it is reported together with errors of other fields
    const { publicActive, days }: Record<string, unknown> = settings;
    if (publicActive === true && Array.isArray(days) && days.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Ohne Besuchstag kann die Online-Anmeldung nicht aktiv sein.',
      });
    }
  },
  { when: () => true }
);

/** Checks the form of the Steuerung; errors are reported per field (`days.0.start` …). */
export function validateNikolausSettings(body: unknown): NikolausSettings {
  return parseWith(settingsSchema, body, (path) => path.join('.'));
}
