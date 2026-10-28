/**
 * Validation of the Gruppenstunden inputs of the Anwesenheit module (notes, cancellation, guests,
 * deletion). Errors are `ValidationError`s with the German messages of the forms.
 */
import { z } from 'zod';
import { choice, labeledText, lenientObject, parseWith } from './zod';

export const MAX_MEETING_NOTES_LENGTH = 2000;
const MAX_ATTENDANCE_LENGTH = 100_000;

export interface MeetingNotesInput {
  notes: string;
  /** The version the editor loaded; `null` if the Termin did not exist yet. */
  etag: string | null;
}

const NO_VERSION = 'Die Version des Termins fehlt. Bitte neu laden.';
const NOTES_INVALID = 'Der Inhalt ist ungültig.';

/** The version the page loaded: a string, or `null` for a Termin that did not exist yet. */
const loadedVersion = z.string({ error: NO_VERSION }).nullable();

/** Plain text with the line breaks kept: at most one empty line, no runs of spaces. */
const meetingNotes = z
  .string({ error: NOTES_INVALID })
  .transform((value) =>
    value
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
  .pipe(
    z.string().max(MAX_MEETING_NOTES_LENGTH, {
      error: `Der Inhalt darf höchstens ${MAX_MEETING_NOTES_LENGTH} Zeichen lang sein.`,
    })
  );

const meetingNotesSchema = lenientObject({ notes: meetingNotes, etag: loadedVersion });

/** What the group did: plain text, line breaks kept. */
export function validateMeetingNotes(body: unknown): MeetingNotesInput {
  return parseWith(meetingNotesSchema, body);
}

const childStatusSchema = lenientObject({
  status: choice('die Anwesenheit', ['anwesend', 'entschuldigt']),
});

/** Whether a child was there (`anwesend`) or excused (`entschuldigt`). */
export function validateChildStatus(body: unknown): 'anwesend' | 'entschuldigt' {
  return parseWith(childStatusSchema, body).status;
}

export interface CancelledInput {
  cancelled: boolean;
  /** The version the page loaded; `null` if the Termin did not exist yet. */
  etag: string | null;
  /**
   * When cancelling: the number of entries (children and guests) the page showed and the
   * leader agreed to delete. Entries do not change the version of the Termin.
   */
  entries: number;
}

const ENTRIES_INVALID = 'Die Zahl der Einträge ist ungültig.';

const cancelledSchema = lenientObject({
  cancelled: z.boolean({ error: 'Die Angabe „Ausgefallen“ ist ungültig.' }),
  etag: loadedVersion,
  entries: z.preprocess(
    (value) => value ?? 0,
    z
      .number({ error: ENTRIES_INVALID })
      .int({ error: ENTRIES_INVALID })
      .min(0, { error: ENTRIES_INVALID })
  ),
});

/** Whether the Gruppenstunde was cancelled, with the state the page loaded. */
export function validateCancelled(body: unknown): CancelledInput {
  return parseWith(cancelledSchema, body);
}

const guestNameSchema = lenientObject({ name: labeledText('den Namen', 100, true) });

/** The name of a guest who is not in CampFlow. */
export function validateGuestName(body: unknown): string {
  return parseWith(guestNameSchema, body).name;
}

const meetingDeletionSchema = lenientObject({
  attendance: z
    .string({ error: 'Lade die Gruppenstunde neu, bevor du sie löschst.' })
    .max(MAX_ATTENDANCE_LENGTH, { error: 'Lade die Gruppenstunde neu, bevor du sie löschst.' }),
});

/** The attendance shown when a leader confirms deleting a Gruppenstunde. */
export function validateMeetingDeletion(body: unknown): string {
  return parseWith(meetingDeletionSchema, body).attendance;
}
