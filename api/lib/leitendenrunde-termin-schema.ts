/**
 * Schemas for the stored JSON the Leitendenrunde reminders read: the field „Nächste
 * Leitendenrunde“ of editor minutes and the workflow fields of Word minutes. Unreadable single
 * fields count as missing.
 */
import { z } from 'zod';
import { isValidDate } from './calendar-date';
import { lenientText } from './protokoll-termin-schema';

/** `HH:MM` within a day, as stored by the editor (no trimming, two digits for the hour). */
const EDITOR_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The content of editor minutes as far as the next meeting is concerned. */
export const editorNextSchema = z.object({
  naechsteSitzung: z.object({
    datum: z.string().refine(isValidDate, { abort: true }),
    uhrzeit: z.string().regex(EDITOR_TIME).nullable().catch(null),
    ort: lenientText(Number.POSITIVE_INFINITY),
  }),
});

/** The workflow fields of Word minutes that decide on a reminder. */
export const wordFieldsSchema = z.object({
  Status: z.string().catch(''),
  FreigegebenAm: z.string().catch(''),
  FreigabeVersion: z.string().catch(''),
  Termin: z.string().catch(''),
});
