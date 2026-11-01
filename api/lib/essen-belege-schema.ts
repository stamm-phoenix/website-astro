/**
 * Schemas of the requests of the receipts of a Planung (`essen-belege-validation.ts` parses with
 * them; the types are declared in `essen-belege-model.ts`). Errors are reported per field.
 */
import { z } from 'zod';
import {
  MAX_BELEG_BETRAG_CENT,
  MAX_BELEG_HAENDLER,
  MAX_BELEG_NAME,
  MAX_BELEG_NOTIZ,
} from './essen-belege-model';
import { isRecord } from './validation/zod';

/** Runs a check even when fields of the same form are invalid, so every field reports. */
const ALWAYS = (): boolean => true;

const LISTE = 'Bitte aus der Liste wählen.';
const DATUM = 'Bitte ein gültiges Datum angeben.';
const BETRAG = 'Bitte einen Betrag größer als 0 € angeben.';
export const BEZAHLT_VON_FEHLT = 'Bitte angeben, wer bezahlt hat.';

/** A trimmed text of one line up to `max` characters; anything but a string is empty. */
function zeile(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().max(max, { error: `Höchstens ${max} Zeichen.` })
  );
}

/** Like `zeile`, but only when sent: a missing field stays undefined. */
function gesendeteZeile(max: number) {
  return z
    .string({ error: 'Bitte als Text angeben.' })
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(z.string().max(max, { error: `Höchstens ${max} Zeichen.` }))
    .optional();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The day of the receipt: a real day since 2000 and not after `heute`. */
function datum(heute: string) {
  return z.string({ error: DATUM }).superRefine((value, ctx) => {
    const message =
      !isIsoDate(value) || value < '2000-01-01'
        ? DATUM
        : value > heute
          ? 'Das Datum liegt in der Zukunft.'
          : '';
    if (message) ctx.addIssue({ code: 'custom', message });
  });
}

const betragCent = z
  .number({ error: BETRAG })
  .int({ error: 'Bitte den Betrag in Euro und Cent angeben, z. B. 12,34.' })
  .min(1, { error: BETRAG })
  .max(MAX_BELEG_BETRAG_CENT, { error: 'Höchstens 10.000 €. Bitte den Betrag prüfen.' });

const bezahltVonId = z.preprocess(
  (value) => (value === undefined ? null : value),
  z
    .number({ error: LISTE })
    .refine((id) => Number.isInteger(id) && id > 0, { error: LISTE })
    .nullable()
);

const erstattet = z.boolean({ error: 'Bitte ankreuzen oder nicht.' });

/** A member or a free name, exactly one of both. */
function pruefeBezahltVon(
  value: { bezahltVonId: number | null; bezahltVonText: string },
  ctx: z.RefinementCtx
): void {
  if (value.bezahltVonId !== null && value.bezahltVonText) {
    ctx.addIssue({
      code: 'custom',
      path: ['bezahltVonText'],
      message: 'Entweder ein Mitglied oder einen Namen.',
    });
  } else if (value.bezahltVonId === null && !value.bezahltVonText) {
    ctx.addIssue({ code: 'custom', path: ['bezahltVonText'], message: BEZAHLT_VON_FEHLT });
  }
}

/** A new receipt, with or without a photo. */
export function belegSchema(heute: string) {
  return z
    .preprocess(
      (value) => (isRecord(value) ? value : {}),
      z.object({
        datum: datum(heute),
        betragCent,
        haendler: zeile(MAX_BELEG_HAENDLER),
        notiz: zeile(MAX_BELEG_NOTIZ),
        bezahltVonId,
        bezahltVonText: zeile(MAX_BELEG_NAME),
        erstattet: erstattet.optional().default(false),
      })
    )
    .superRefine(pruefeBezahltVon, { when: ALWAYS });
}

/** Whether the body names who paid; sending one of the two fields sets both. */
function mitBezahltVon(value: Record<string, unknown>): boolean {
  return 'bezahltVonId' in value || 'bezahltVonText' in value;
}

/** The fields of a receipt that were sent. */
export function belegAenderungSchema(heute: string) {
  return z
    .preprocess(
      // No object at all (bad JSON, null, a list) sends nothing, which is named in German
      (value) =>
        isRecord(value)
          ? { ...value, mitBezahltVon: mitBezahltVon(value) }
          : { mitBezahltVon: false },
      z.object({
        datum: datum(heute).optional(),
        betragCent: betragCent.optional(),
        haendler: gesendeteZeile(MAX_BELEG_HAENDLER),
        notiz: gesendeteZeile(MAX_BELEG_NOTIZ),
        bezahltVonId,
        bezahltVonText: zeile(MAX_BELEG_NAME),
        erstattet: erstattet.optional(),
        mitBezahltVon: z.boolean(),
      })
    )
    .superRefine(
      (value, ctx) => {
        if (value.mitBezahltVon) pruefeBezahltVon(value, ctx);
      },
      { when: ALWAYS }
    );
}
