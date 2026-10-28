/** Request bodies of the Protokoll-Editor (#277): new minutes, the lock and a save. */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { ELEMENT_ID, MAX_TITEL } from '../protokoll-editor-model';
import { protokollInhaltSchema, TIME } from './protokoll-inhalt-schema';
import { flagSchema } from './protokolle';
import { labeledText, lenientObject, parseWith } from './zod';

/** Token of the writing tab: random, created by the browser. */
const SPERRE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** What is not text is read as missing, so the field reports the rule instead of its type. */
const textOrEmpty = (value: unknown): unknown => (typeof value === 'string' ? value : '');

const titleSchema = labeledText('einen Titel', MAX_TITEL, true);
const dateSchema = z.preprocess(
  textOrEmpty,
  z.string().refine(isValidDate, { error: 'Bitte das Datum der Sitzung angeben.' })
);

const createSchema = lenientObject({
  title: titleSchema,
  date: dateSchema,
  /** Start of the meeting („HH:MM“, local time of the browser) or empty. */
  beginn: z.preprocess(
    textOrEmpty,
    z.string().refine((value) => value === '' || TIME.test(value), {
      error: 'Bitte eine Uhrzeit wie 19:30 angeben.',
    })
  ),
});

export type ProtokollEditorCreateInput = z.output<typeof createSchema>;

/** Title and date of new minutes, optionally the start of the meeting. */
export function validateProtokollEditorCreate(body: unknown): ProtokollEditorCreateInput {
  return parseWith(createSchema, body);
}

const sperreShape = {
  token: z.preprocess(
    textOrEmpty,
    z.string().regex(SPERRE_TOKEN, { error: 'Die Sitzung des Editors ist ungültig.' })
  ),
  /** Take over a lock another tab holds and that has not run out. */
  uebernehmen: z.preprocess((value) => value === true, z.boolean()),
  aktiverPunkt: z
    .string({ error: 'Der aktive Tagesordnungspunkt ist ungültig.' })
    .regex(ELEMENT_ID, { error: 'Der aktive Tagesordnungspunkt ist ungültig.' })
    .nullish()
    .transform((value) => value ?? null),
};
const sperreSchema = lenientObject(sperreShape);

export type ProtokollSperreInput = z.output<typeof sperreSchema>;

/** Taking, renewing or releasing the lock. */
export function validateProtokollSperre(body: unknown): ProtokollSperreInput {
  return parseWith(sperreSchema, body);
}

const saveSchema = lenientObject({
  ...sperreShape,
  etag: labeledText('Die Version', 100, true),
  title: titleSchema,
  date: dateSchema,
  inhalt: protokollInhaltSchema,
  /** Keep the stored version as a revision first (a local or older version replaces it). */
  sicherung: z.preprocess(
    (value) => value ?? null,
    z
      .enum(['ueberschreiben', 'wiederherstellen'], { error: 'Die Sicherung ist ungültig.' })
      .nullable()
  ),
});

export type ProtokollSicherung = 'ueberschreiben' | 'wiederherstellen';
export type ProtokollEditorSaveInput = z.output<typeof saveSchema>;

/** A save of the editor: the whole document with the version it was based on. */
export function validateProtokollEditorSave(body: unknown): ProtokollEditorSaveInput {
  return parseWith(saveSchema, body);
}

/** Token of the writing tab in a body, or `null` if it has not the form of a token. */
const tokenOrNull = z.preprocess(
  (value) => (typeof value === 'string' && SPERRE_TOKEN.test(value) ? value : null),
  z.string().nullable()
);

const reviewSchema = lenientObject({
  action: z.enum(['review', 'approve', 'reject'], { error: 'Unbekannte Aktion.' }),
  token: tokenOrNull,
  /** The author confirmed to approve their own minutes. */
  ownConfirmed: flagSchema,
  /** Why the minutes go back; trimmed later by the one who uses it. */
  note: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string()),
});

export type ProtokollEditorReviewInput = z.output<typeof reviewSchema>;

/** A step of the review: give the draft to the review, approve it or send it back. */
export function validateProtokollEditorReview(body: unknown): ProtokollEditorReviewInput {
  return parseWith(reviewSchema, body, () => 'form');
}

const aufgabeSchema = lenientObject({
  erledigt: z.boolean({ error: 'Bitte angeben, ob die Aufgabe erledigt ist.' }),
});

/** Whether an open task was ticked off in the meeting. */
export function validateProtokollEditorAufgabe(body: unknown): boolean {
  return parseWith(aufgabeSchema, body).erledigt;
}
