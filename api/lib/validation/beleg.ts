/** Validation of the receipts (Belege) of the Leitendenbereich. */
import { z } from 'zod';
import { choice, isRecord, labeledText, parseWith } from './zod';

/**
 * Review states of a receipt. The real bookkeeping happens in CampFlow; here the Kasse only
 * accepts a receipt (then transfers it to CampFlow) or rejects it with a reason.
 */
export const BELEG_STATUSES = ['Eingereicht', 'Angenommen', 'Abgelehnt'] as const;
export type BelegStatus = (typeof BELEG_STATUSES)[number];

/** An expense, or income such as a donation or a fee paid in cash; income has no Auslage. */
export const BELEG_ARTEN = ['Ausgabe', 'Einnahme'] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number];

/** Photos are scaled down in the browser; this only guards against oversized requests. */
export const MAX_BELEG_PHOTO_BYTES = 4 * 1024 * 1024;
/** A receipt as PDF, e.g. an invoice by mail; with its page and in base64 the request stays small. */
export const MAX_BELEG_PDF_BYTES = 5 * 1024 * 1024;
/** Shorter photos are too small to read a receipt. */
export const MIN_BELEG_PHOTO_EDGE = 800;
/** Kostenstelle and Kategorie; CampFlow's own names are far shorter. */
export const MAX_BELEG_ZUORDNUNG = 120;
/** 10.000 € – anything above is surely a typo. */
const MAX_BELEG_CENT = 1_000_000;

export interface BelegInput {
  art: BelegArt;
  shop: string;
  /** Date of the receipt, `YYYY-MM-DD`. */
  date: string;
  amountCent: number;
  /** Who gets the Auslage back; empty without one. */
  paidBy: string;
  /** Whether it is an Auslage: someone or the savings book gets the money. */
  payout: boolean;
  /** Older receipts only; it stands in for Kostenstelle and Kategorie where they are missing. */
  aktion: string;
  /** Name of the Kostenstelle in CampFlow; one that does not exist is created on transfer. */
  kostenstelle: string;
  /** Name of the Kategorie; one the Kostenstelle lacks is created on transfer. */
  kategorie: string;
  note: string;
  status: BelegStatus;
  /** Remark of the Kasse; for a rejected receipt the reason sent to the uploader. */
  reviewNote: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const INVALID_DATE = 'Bitte ein gültiges Datum angeben.';
const INVALID_AMOUNT = 'Bitte einen Betrag größer als 0 € angeben.';
const REVIEW_NOTE_REQUIRED = 'Bitte begründen, warum der Beleg abgelehnt wird.';
const REVIEW_NOTE_TOO_LONG = 'die Bemerkung der Kasse darf höchstens 1000 Zeichen lang sein.';

/** A missing value takes the default; anything else is checked as sent. */
function withDefault<T extends string>(fallback: T) {
  return (value: unknown): unknown => (value === undefined ? fallback : value);
}

/** The receipt date as text: a real day since 2000, and not after `today`. */
function dateField(today: string) {
  return labeledText('das Datum', 10, true).superRefine((value, context) => {
    if (!value) return;
    const message = !isIsoDate(value)
      ? INVALID_DATE
      : value > today
        ? 'Das Datum liegt in der Zukunft.'
        : value < '2000-01-01'
          ? INVALID_DATE
          : '';
    if (message) context.addIssue({ code: 'custom', message });
  });
}

/** The note of the Kasse; a rejection needs it, and every fault of it asks for the reason. */
function reviewNoteField(rejected: boolean) {
  if (!rejected) return labeledText('die Bemerkung der Kasse', 1000);
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().min(1, { error: REVIEW_NOTE_REQUIRED }).max(1000, { error: REVIEW_NOTE_TOO_LONG })
  );
}

interface BelegRules {
  today: string;
  /** An Auslage names who gets the money back. */
  payout: boolean;
  /** Kostenstelle and Kategorie are required. */
  zuordnung: boolean;
  /** A rejection needs a reason. */
  rejected: boolean;
}

function belegSchema({ today, payout, zuordnung, rejected }: BelegRules) {
  return z.object({
    // Receipts from before income was possible are expenses
    art: z.preprocess(withDefault('Ausgabe'), choice('die Art des Belegs', BELEG_ARTEN)),
    shop: labeledText('das Geschäft', 100, true),
    date: dateField(today),
    amountCent: z
      .number({ error: INVALID_AMOUNT })
      .refine(Number.isInteger, { error: INVALID_AMOUNT })
      .refine((value) => value > 0, { error: INVALID_AMOUNT })
      .max(MAX_BELEG_CENT, { error: 'Der Betrag ist zu hoch.' }),
    // Who gets the Auslage back, also „Sparbuch“; nobody when the Stamm paid
    paidBy: labeledText('wer das Geld ausgelegt hat', 100, payout),
    kostenstelle: labeledText('die Kostenstelle', MAX_BELEG_ZUORDNUNG, zuordnung),
    kategorie: labeledText('die Kategorie', MAX_BELEG_ZUORDNUNG, zuordnung),
    note: labeledText('die Bemerkung', 1000),
    status: z.preprocess(withDefault('Eingereicht'), choice('den Status', BELEG_STATUSES)),
    reviewNote: reviewNoteField(rejected),
  });
}

/** Text as the form fields read it, to tell whether Kostenstelle or Kategorie is filled in. */
function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validates the details of a receipt.
 * @param today Current date as `YYYY-MM-DD`; receipts from the future are rejected.
 * @param aktion The Aktion stored with an older receipt; it is no longer entered.
 */
export function validateBeleg(body: unknown, today: string, aktion = ''): BelegInput {
  const record = isRecord(body) ? body : {};
  // Only an expense can be an Auslage
  const payout = (record.art === undefined || record.art === 'Ausgabe') && record.payout === true;
  const parsed = parseWith(
    belegSchema({
      today,
      payout,
      // A receipt from before Kostenstelle and Kategorie keeps its Aktion until someone picks them
      zuordnung: !aktion || isFilled(record.kostenstelle) || isFilled(record.kategorie),
      rejected: record.status === 'Abgelehnt',
    }),
    record
  );
  return { ...parsed, payout, aktion, paidBy: payout ? parsed.paidBy : '' };
}
