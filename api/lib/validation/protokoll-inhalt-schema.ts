/**
 * Schema of the document the Protokoll-Editor saves (`ProtokollInhalt`, #277). The text is kept
 * exactly as typed (the editor saves while typing, so trimming would fight the cursor) and only
 * checked for length and control characters. Unknown fields are dropped, so the stored JSON is
 * rebuilt from known fields only. Every message names the spot that is wrong; they are all shown
 * at the field `inhalt`.
 */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { CAMPFLOW_EVENT_ID_PATTERN } from '../campflow';
import {
  ELEMENT_ID,
  MAX_AUFGABEN,
  MAX_INHALT_BYTES,
  MAX_OFFENE_AUFGABEN,
  MAX_PROTOKOLLANT,
  MAX_PUNKTE,
  MAX_SITZUNGSLEITUNG,
  MAX_TEILNEHMENDE,
  MAX_TERMINE,
  MAX_TEXT,
  MAX_TITEL,
  MAX_UNTERPUNKTE,
  MAX_ZUSTAENDIG,
} from '../protokoll-editor-model';
import type { ProtokollInhalt, ProtokollPerson } from '../protokoll-editor-model';

/** Control characters other than tab and line breaks; typed text never contains them. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_TASK_ID = 999_999_999;
const ID_MESSAGE = 'Ein Element des Protokolls hat keine gültige ID.';

/** Text as typed; `line` forbids line breaks. `what` starts the sentence („Der Titel …“). */
function text(what: string, max: number, line = true) {
  return z
    .string({ error: `${what} fehlt.` })
    .max(max, { error: `${what} darf höchstens ${max} Zeichen lang sein.` })
    .refine((value) => !CONTROL_CHARS.test(value) && !(line && /[\r\n]/.test(value)), {
      error: `${what} enthält ungültige Zeichen.`,
    });
}

/** A date or time that may be empty while it is being typed. */
function optional(what: string, valid: (value: string) => boolean) {
  return z
    .string({ error: `${what} ist ungültig.` })
    .refine((value) => value === '' || valid(value), { error: `${what} ist ungültig.` });
}

const optionalDate = (what: string) => optional(what, isValidDate);
const optionalTime = (what: string) => optional(what, (value) => TIME.test(value));

/** A list with a limit that is checked before its items, so a long list reports its length. */
function list<T extends z.ZodType>(item: T, what: string, max: number) {
  return z
    .array(z.unknown(), { error: `${what} fehlt.` })
    .max(max, { error: `Höchstens ${max} ${what}.` })
    .pipe(z.array(item));
}

/** Missing in minutes stored before the field existed. */
const orDefault = <T extends z.ZodType>(schema: T, fallback: unknown) =>
  z.preprocess((value) => value ?? fallback, schema);

const elementId = z.string({ error: ID_MESSAGE }).regex(ELEMENT_ID, { error: ID_MESSAGE });

/** A row of the module Aufgaben: a positive whole number. */
function taskId(what: string) {
  const error = `${what} ist ungültig.`;
  return z.number({ error }).int({ error }).min(1, { error }).max(MAX_TASK_ID, { error });
}

const personShape = {
  login: text('Der Login', 254),
  name: text('Der Name', MAX_TITEL),
};
const personSchema = z.object(personShape, { error: 'Eine Person fehlt.' });

/**
 * People of the head. Minutes written before #301 hold one typed string; it is read as one
 * person without login, so they look the same as before.
 */
function people(what: string, max: number) {
  const name = text(what, MAX_TITEL).transform((value): ProtokollPerson[] =>
    value.trim() ? [{ login: '', name: value }] : []
  );
  const persons = list(personSchema, what, max);
  return z.unknown().transform((value, ctx) => {
    const result = (typeof value === 'string' ? name : persons).safeParse(value);
    if (result.success) return result.data;
    ctx.addIssue({ code: 'custom', message: result.error.issues[0].message });
    return z.NEVER;
  });
}

const teilnahmeSchema = z.object(
  {
    ...personShape,
    status: z.enum(['anwesend', 'entschuldigt'], {
      error: 'Die Anwesenheit einer Person ist ungültig.',
    }),
  },
  { error: 'Eine teilnehmende Person fehlt.' }
);

const aufgabeSchema = z.object(
  {
    id: elementId,
    titel: text('Der Titel einer Aufgabe', 500),
    zustaendig: list(personSchema, 'Zuständige', MAX_ZUSTAENDIG),
    faellig: optionalDate('Die Fälligkeit einer Aufgabe'),
  },
  { error: 'Eine Aufgabe fehlt.' }
);

const terminSchema = z.object(
  {
    id: elementId,
    titel: text('Der Titel eines Termins', 500),
    datum: optionalDate('Das Datum eines Termins'),
    uhrzeit: optionalTime('Die Uhrzeit eines Termins'),
    ort: text('Der Ort eines Termins', MAX_TITEL),
    zustaendig: list(personSchema, 'Zuständige', MAX_ZUSTAENDIG),
  },
  { error: 'Ein Termin fehlt.' }
);

const aktionError = 'Die Aktion eines Tagesordnungspunkts ist ungültig.';
const aktionSchema = z.object(
  {
    id: z
      .string({ error: aktionError })
      .refine((value) => CAMPFLOW_EVENT_ID_PATTERN.test(value), { error: aktionError }),
    titel: text('Der Name der Aktion', MAX_TITEL),
    start: optionalDate('Der Beginn der Aktion'),
    ende: optionalDate('Das Ende der Aktion'),
  },
  { error: 'Die Aktion fehlt.' }
);

const projektSchema = z.object(
  {
    id: taskId('Das Projekt eines Tagesordnungspunkts'),
    titel: text('Der Name des Projekts', MAX_TITEL),
  },
  { error: 'Das Projekt fehlt.' }
);

const offeneAufgabeSchema = z.object(
  {
    id: taskId('Eine offene Aufgabe'),
    titel: text('Der Titel einer offenen Aufgabe', 500),
    zustaendig: list(personSchema, 'Zuständige', 20),
    faellig: optionalDate('Die Fälligkeit einer offenen Aufgabe'),
    erledigt: z.boolean({ error: 'Der Stand einer offenen Aufgabe ist ungültig.' }),
  },
  { error: 'Eine offene Aufgabe fehlt.' }
);

const punktShape = {
  id: elementId,
  titel: text('Der Titel eines Tagesordnungspunkts', MAX_TITEL),
  aktion: orDefault(aktionSchema.nullable(), null),
  text: text('Der Text eines Tagesordnungspunkts', MAX_TEXT, false),
  aufgaben: list(aufgabeSchema, 'Aufgaben', MAX_AUFGABEN),
  // Missing in minutes stored before #297
  termine: orDefault(list(terminSchema, 'Termine', MAX_TERMINE), []),
  // Both missing in minutes stored before step 3 of #277
  projekt: orDefault(projektSchema.nullable(), null),
  offeneAufgaben: orDefault(list(offeneAufgabeSchema, 'offene Aufgaben', MAX_OFFENE_AUFGABEN), []),
};
const PUNKT_ERROR = { error: 'Ein Tagesordnungspunkt fehlt.' };

/** Sub-items have no sub-items of their own. */
const unterpunktSchema = z.object(
  { ...punktShape, unterpunkte: list(z.never(), 'Unterpunkte', 0) },
  PUNKT_ERROR
);
const punktSchema = z.object(
  { ...punktShape, unterpunkte: list(unterpunktSchema, 'Unterpunkte', MAX_UNTERPUNKTE) },
  PUNKT_ERROR
);

const kopfSchema = z.object(
  {
    sitzungsleitung: people('Die Sitzungsleitung', MAX_SITZUNGSLEITUNG),
    protokollant: people('Wer Protokoll führt', MAX_PROTOKOLLANT),
    beginn: optionalTime('Der Sitzungsbeginn'),
    ende: optionalTime('Das Sitzungsende'),
    teilnehmende: list(teilnahmeSchema, 'Teilnehmende', MAX_TEILNEHMENDE),
    externe: text('Die Externen', 2000, false),
  },
  { error: 'Der Kopf fehlt.' }
);

const naechsteSitzungSchema = z.object(
  {
    datum: optionalDate('Das Datum der nächsten Sitzung'),
    uhrzeit: optionalTime('Die Uhrzeit der nächsten Sitzung'),
    ort: text('Der Ort der nächsten Sitzung', MAX_TITEL),
  },
  { error: 'Die nächste Sitzung fehlt.' }
);

/** Every item, task and date of the document carries an ID that is unique in it. */
function elementIds(inhalt: z.output<typeof inhaltDocument>): string[] {
  const ids: string[] = [];
  const take = (
    punkt: Pick<z.output<typeof unterpunktSchema>, 'id' | 'aufgaben' | 'termine'>
  ): void => {
    ids.push(punkt.id);
    for (const element of [...punkt.aufgaben, ...punkt.termine]) ids.push(element.id);
  };
  for (const punkt of inhalt.punkte) {
    take(punkt);
    for (const unterpunkt of punkt.unterpunkte) take(unterpunkt);
  }
  return ids;
}

const inhaltDocument = z.object(
  {
    kopf: kopfSchema,
    punkte: list(punktSchema, 'Tagesordnungspunkte', MAX_PUNKTE),
    naechsteSitzung: naechsteSitzungSchema,
  },
  { error: 'Der Inhalt fehlt.' }
);

/**
 * The whole document. The type is the interface of `protokoll-editor-model.ts`, which the web
 * frontend shares; the annotation makes the compiler check that this schema produces it.
 */
export const protokollInhaltSchema: z.ZodType<ProtokollInhalt> = z
  .unknown()
  .superRefine((value, ctx) => {
    if (JSON.stringify(value ?? null).length > MAX_INHALT_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Das Protokoll ist zu lang.' });
    }
  })
  .pipe(
    inhaltDocument.superRefine((inhalt, ctx) => {
      const ids = elementIds(inhalt);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: ID_MESSAGE });
    })
  );
