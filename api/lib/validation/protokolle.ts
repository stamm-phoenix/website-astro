/** Request bodies of the minutes workflow (SharePoint files and the Protokoll-Editor). */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { lenientObject, parseWith } from './zod';

const MAX_TITLE = 80;
const MAX_NOTE = 2000;
/** What a file name of the minutes (`<date> <title>.docx`) must not contain. */
const FILE_NAME_CHARS = /["*:<>?/\\|#%]/;

/** A flag that only `true` switches on; anything else is `false`. */
export const flagSchema = z.preprocess((value) => value === true, z.boolean());

const createSchema = lenientObject({
  title: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z
      .string()
      .refine((title) => title !== '' && title.length <= MAX_TITLE, {
        error: `Bitte einen Titel mit höchstens ${MAX_TITLE} Zeichen angeben.`,
        abort: true,
      })
      .refine((title) => !FILE_NAME_CHARS.test(title), {
        error: 'Der Titel darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %',
      })
  ),
  date: z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().refine(isValidDate, { error: 'Bitte das Datum der Sitzung angeben.' })
  ),
});

export type ProtokollCreateInput = z.output<typeof createSchema>;

/** Title and date of new minutes from the template; the title becomes part of the file name. */
export function validateProtokollCreate(body: unknown): ProtokollCreateInput {
  return parseWith(createSchema, body);
}

/** The step asked for; anything but one of `actions` is „Unbekannte Aktion.“. */
export function validateProtokollAction<const T extends readonly [string, ...string[]]>(
  body: unknown,
  actions: T
): T[number] {
  const schema = lenientObject({ action: z.enum(actions, { error: 'Unbekannte Aktion.' }) });
  return parseWith(schema, body, () => 'form').action;
}

const versandSchema = lenientObject({
  action: z.enum(['preview', 'send'], { error: 'Unbekannte Aktion.' }),
  retry: flagSchema,
});

/** The mailing step: the list of recipients (`preview`) or the mail itself (`send`). */
export function validateProtokollVersand(body: unknown): {
  action: 'preview' | 'send';
  retry: boolean;
} {
  return parseWith(versandSchema, body, () => 'form');
}

const noteSchema = lenientObject({
  note: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_NOTE) : ''),
    z.string()
  ),
});

/** The reason of a rejection, trimmed and cut; missing is empty. */
export function readProtokollNote(body: unknown): string {
  return parseWith(noteSchema, body).note;
}
