/**
 * Validation of the Dispo of the Nikolausdienst: the plan of a day before saving and the visits
 * checked off in the Fahrt view. Errors are `ValidationError`s with the messages of the forms.
 */
import { z } from 'zod';
import { lenientObject, parseWith } from './zod';

export interface DispoLoadedCheckOff {
  bookingId: string;
  /** Exact time of the check-off as the Dispo delivered it. */
  checkedOffAt: string;
}

export interface DispoSaveInput {
  version: string;
  /** Visits checked off when the Dispo was loaded, with their time; the plan is built on them. */
  done?: DispoLoadedCheckOff[];
  entries: {
    bookingId: string;
    team: string;
    order: number;
    slotKey: string;
    plannedArrival: string;
    fixed: boolean;
  }[];
}

const MAX_DISPO_ENTRIES = 200;
const DISPO_INVALID = 'Die Dispo ist ungültig.';

/** What the browser sent per entry; the rules follow once the day's bookings and teams are known. */
const entrySchema = lenientObject({
  bookingId: z.string().catch(''),
  team: z.string().catch(''),
  order: z.number().catch(NaN),
  plannedArrival: z.string().catch(''),
  fixed: z
    .unknown()
    .optional()
    .transform((value) => value === true),
});

const checkOffSchema = z.object({ bookingId: z.string(), checkedOffAt: z.string() });

/** The check-offs the Dispo was loaded with; malformed ones are skipped, a missing list stays absent. */
const loadedCheckOffs = z
  .unknown()
  .optional()
  .transform((value): DispoLoadedCheckOff[] | null =>
    Array.isArray(value)
      ? value.flatMap((item) => {
          const checkOff = checkOffSchema.safeParse(item);
          return checkOff.success ? [checkOff.data] : [];
        })
      : null
  );

/**
 * The Dispo of a day: the entries must be bookings that are still confirmed, one team each, with a
 * known order and arrival. All problems of the entries are reported at `entries`; the last wins.
 */
function dispoSaveSchema(teams: readonly string[], bookingSlots: Map<string, string>) {
  return lenientObject({
    version: z.string().catch(''),
    entries: z
      .array(entrySchema, { error: DISPO_INVALID })
      .max(MAX_DISPO_ENTRIES, { error: DISPO_INVALID })
      .superRefine((entries, ctx) => {
        const seen = new Set<string>();
        let message: string | null = null;
        for (const { bookingId, team, order, plannedArrival } of entries) {
          if (!bookingSlots.has(bookingId)) {
            message = 'Die Dispo enthält Termine, die nicht mehr bestätigt sind. Bitte neu laden.';
          } else if (seen.has(bookingId)) {
            message = 'Ein Termin ist mehreren Teams zugeordnet.';
          } else if (!teams.includes(team)) {
            message = `Team „${team}“ gibt es an diesem Tag nicht.`;
          } else if (!Number.isInteger(order) || order < 1 || order > MAX_DISPO_ENTRIES) {
            message = 'Die Reihenfolge ist ungültig.';
          } else if (!/^\d{2}:\d{2}$/.test(plannedArrival)) {
            message = 'Die geplante Ankunft ist ungültig.';
          }
          seen.add(bookingId);
        }
        if (message) ctx.addIssue({ code: 'custom', message });
      }),
    done: loadedCheckOffs,
  }).transform(({ version, entries, done }): DispoSaveInput => ({
    version,
    entries: entries.map((entry) => ({
      ...entry,
      // The slot is taken from the booking, not from the browser
      slotKey: bookingSlots.get(entry.bookingId) ?? '',
    })),
    done: done ?? undefined,
  }));
}

/**
 * Checks the Dispo of a day before saving.
 * @param teams Team names of the day.
 * @param bookingSlots Slot key per booking ID of the confirmed bookings of the day.
 */
export function validateDispoSave(
  body: unknown,
  teams: string[],
  bookingSlots: Map<string, string>
): DispoSaveInput {
  return parseWith(dispoSaveSchema(teams, bookingSlots), body);
}

export interface DispoVisitInput {
  slotKey: string;
  bookingId: string;
  visited: boolean;
  operationId: string;
  version: string;
}

const VISIT_INVALID = 'Der Besuch ist ungültig.';
const VISIT_RELOAD = 'Bitte die Route neu laden, bevor Besuche gespeichert werden.';

// The first two fields name the visit, the others the state the retry is built on; both report
// at `visit`, and the first message in this order wins.
const dispoVisitSchema = lenientObject({
  bookingId: z.string({ error: VISIT_INVALID }).regex(/^\d{1,10}$/, { error: VISIT_INVALID }),
  visited: z.boolean({ error: VISIT_INVALID }),
  operationId: z
    .string({ error: VISIT_RELOAD })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, {
      error: VISIT_RELOAD,
    }),
  version: z.string({ error: VISIT_RELOAD }).regex(/^[0-9a-f]{64}$/, { error: VISIT_RELOAD }),
  slotKey: z
    .string({ error: VISIT_RELOAD })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: VISIT_RELOAD }),
});

/** Validate the requested visit and the operation/version pair used for safe offline retries. */
export function validateDispoVisit(body: unknown): DispoVisitInput {
  return parseWith(dispoVisitSchema, body, () => 'visit');
}
