/**
 * Validation of the public content the staff edits: FAQ, Gruppenstunden, the calendar (Aktionen)
 * and the Leitende. Formatted text is sanitized here, the schemas check the rest.
 */
import { z } from 'zod';
import { isValidDate } from '../calendar-date';
import { CAMPFLOW_EVENT_ID_PATTERN } from '../campflow';
import { VORSTAND_TEAM } from './constants';
import { sanitize } from './rich-text';
import { choices, isRecord, labeledText, lenientObject, parseWith } from './zod';

const MAX_DESCRIPTION_LENGTH = 5000;
const HTTPS_URL = /^https:\/\/[^\s"'<>`]+$/i;

// `z.unknown()` needs `.optional()` here: a missing key would be an error otherwise

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One of the allowed strings; unlike `choice`, the allowed values are only known at runtime. */
function choiceOf(label: string, allowed: readonly string[]) {
  const message = `Bitte eine gültige Auswahl für ${label} treffen.`;
  return z
    .string({ error: message })
    .refine((value) => allowed.includes(value), { error: message });
}

/** The description of a Gruppenstunde or Aktion: sanitized, at most 5000 visible characters. */
const descriptionSchema = z
  .unknown()
  .optional()
  .transform((raw, ctx) => {
    const sanitized = sanitize(text(raw));
    if (sanitized.textLength > MAX_DESCRIPTION_LENGTH) {
      ctx.issues.push({
        code: 'custom',
        input: raw,
        message: `Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen lang sein.`,
      });
    }
    return sanitized.html;
  });

// --- Fragen & Antworten ---

export interface QuestionAndAnswerInput {
  published: boolean;
  question: string;
  answer: string;
  category: string;
}

const ANSWER_TOO_LONG = 'Die Antwort ist zu lang. Bitte auf höchstens 5000 Zeichen kürzen.';

/** The answer as sanitized, kept with the input so the rules below can tell what was sent. */
const answerSchema = z
  .unknown()
  .optional()
  .transform((raw) => ({ raw, ...sanitize(text(raw), { links: true }) }));

/**
 * Status and answer belong together: only a draft may have no answer. The rules report in order
 * of precedence (the first message of a field is the one shown) and next to the other fields.
 */
const questionAndAnswerSchema = lenientObject({
  question: labeledText('eine Frage', 255, true),
  category: labeledText('das Thema', 100).transform((category) => category || 'Allgemein'),
  published: z.unknown().optional(),
  answer: answerSchema,
})
  .refine(({ published }) => typeof published === 'boolean', {
    path: ['published'],
    error: 'Bitte einen gültigen Veröffentlichungsstatus angeben.',
    when: () => true,
  })
  .refine(({ answer }) => answer.textLength <= 5000 && answer.html.length <= 60000, {
    path: ['answer'],
    error: ANSWER_TOO_LONG,
    when: () => true,
  })
  .refine(({ published, answer }) => published === false || answer.hasVisibleText, {
    path: ['answer'],
    error: 'Bitte eine Antwort angeben.',
    when: () => true,
  })
  .refine(({ answer }) => typeof answer.raw === 'string', {
    path: ['answer'],
    error: 'Bitte eine gültige Antwort angeben.',
    when: () => true,
  })
  .transform(({ question, category, published, answer }) => ({
    question,
    category,
    answer: answer.html,
    published: published === true,
  }));

/** Validates FAQ fields and keeps only the formatting (and links) supported by the public FAQ. */
export function validateQuestionAndAnswer(body: unknown): QuestionAndAnswerInput {
  return parseWith(questionAndAnswerSchema, body);
}

// --- Gruppenstunden ---

export interface GruppenstundeInput {
  stufe: string;
  weekday: string;
  time: string;
  ageRange: string;
  location: string;
  description: string;
}

function gruppenstundeSchema(stufen: string[]) {
  return lenientObject({
    stufe: choiceOf('die Stufe', stufen),
    weekday: labeledText('den Wochentag', 30, true),
    time: labeledText('die Uhrzeit', 60, true),
    ageRange: labeledText('das Alter', 60),
    location: labeledText('den Ort', 120, true),
    description: descriptionSchema,
  });
}

export function validateGruppenstunde(body: unknown, stufen: string[]): GruppenstundeInput {
  return parseWith(gruppenstundeSchema(stufen), body);
}

// --- Aktionen (public calendar) ---

export interface AktionInput {
  /** CampFlow event the entry belongs to; then title, dates and link come from CampFlow. */
  campflowId: string | null;
  stufen: string[];
  description: string;
  title: string;
  start: string;
  end: string;
  link: string;
}

const campflowIdSchema = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && CAMPFLOW_EVENT_ID_PATTERN.test(value)) return value;
    ctx.issues.push({ code: 'custom', input: value, message: 'Die CampFlow-Aktion ist ungültig.' });
    return null;
  });

function aktionShape(stufen: string[]) {
  return {
    campflowId: campflowIdSchema,
    stufen: choices('Die Auswahl der Stufen', stufen).refine((selected) => selected.length > 0, {
      error: 'Bitte mindestens eine Stufe auswählen.',
    }),
    description: descriptionSchema,
  };
}

/** What CampFlow provides for a linked entry; the caller takes it from there. */
const FROM_CAMPFLOW = { title: '', start: '', end: '', link: '' };

/**
 * A date as typed: only a real date passes. Text that is too long is no date either, so the
 * length needs no message of its own.
 */
function dateText(label: string, required: boolean, invalid: string) {
  return labeledText(label, Infinity, required).refine((value) => !value || isValidDate(value), {
    error: invalid,
  });
}

function freeAktionSchema(stufen: string[]) {
  return lenientObject({
    ...aktionShape(stufen),
    title: labeledText('einen Titel', 255, true),
    start: dateText('ein Startdatum', true, 'Bitte ein gültiges Startdatum angeben.'),
    end: dateText('das Enddatum', false, 'Bitte ein gültiges Enddatum angeben.'),
    // The scheme is checked before the length, as a link that is no URL needs that message first
    link: labeledText('Der Anmeldelink', Infinity)
      .refine((value) => !value || HTTPS_URL.test(value), {
        error: 'Der Anmeldelink muss mit https:// beginnen.',
      })
      .refine((value) => value.length <= 255, {
        error: 'Der Anmeldelink darf höchstens 255 Zeichen lang sein.',
      }),
  })
    .refine(({ start, end }) => !(text(end) && text(start) && text(end) < text(start)), {
      path: ['end'],
      error: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
      // Reported next to the problems of the other fields
      when: () => true,
    })
    .transform((input) => ({ ...input, end: input.end || input.start }));
}

function linkedAktionSchema(stufen: string[]) {
  return lenientObject(aktionShape(stufen)).transform((input) => ({ ...input, ...FROM_CAMPFLOW }));
}

/**
 * Validates a calendar entry. For entries linked to CampFlow (`campflowId` set) title, dates and
 * link are ignored here; the caller takes them from CampFlow.
 */
export function validateAktion(body: unknown, stufen: string[]): AktionInput {
  const id = isRecord(body) ? body.campflowId : undefined;
  const linked = typeof id === 'string' && CAMPFLOW_EVENT_ID_PATTERN.test(id);
  return parseWith(linked ? linkedAktionSchema(stufen) : freeAktionSchema(stufen), body);
}

// --- Leitende ---

export interface LeitendeInput {
  name: string;
  teams: string[];
  phone: string;
  street: string;
  postalCode: string;
  city: string;
}

const CONTACT_FIELDS = ['phone', 'street', 'postalCode', 'city'] as const;
const PHONE = /^[+0-9][0-9 ()/-]{3,}$/;

/**
 * The contact details as they are kept: only the Vorstand has any. The rules below check these,
 * also while another field of the input is wrong.
 */
function keptContact(value: Record<string, unknown>, teams: string[]): Record<string, string> {
  const selected = Array.isArray(value.teams) ? (value.teams as unknown[]) : [];
  const vorstand =
    selected.includes(VORSTAND_TEAM) && selected.every((team) => teams.includes(String(team)));
  return Object.fromEntries(CONTACT_FIELDS.map((key) => [key, vorstand ? text(value[key]) : '']));
}

function leitendeSchema(teams: string[]) {
  const contact = (value: object): Record<string, string> =>
    keptContact(value as Record<string, unknown>, teams);
  const always = { when: () => true };
  return lenientObject({
    name: labeledText('den Namen', 100, true),
    teams: choices('Teams', teams),
    phone: labeledText('Telefon', 40),
    street: labeledText('Straße', 120),
    postalCode: labeledText('PLZ', 10),
    city: labeledText('Ort', 80),
  })
    .refine((value) => !contact(value).phone || PHONE.test(contact(value).phone ?? ''), {
      path: ['phone'],
      error: 'Bitte eine gültige Telefonnummer angeben.',
      ...always,
    })
    .refine(
      (value) => !contact(value).postalCode || /^\d{5}$/.test(contact(value).postalCode ?? ''),
      {
        path: ['postalCode'],
        error: 'Bitte eine fünfstellige PLZ angeben.',
        ...always,
      }
    )
    .refine(
      (value) => {
        const kept = contact(value);
        const parts = [kept.street, kept.postalCode, kept.city].filter(Boolean).length;
        return parts === 0 || parts === 3;
      },
      {
        path: ['street'],
        error: 'Bitte die Adresse vollständig oder gar nicht angeben.',
        ...always,
      }
    )
    .transform((value) => ({ ...value, ...contact(value) }));
}

export function validateLeitende(body: unknown, teams: string[]): LeitendeInput {
  return parseWith(leitendeSchema(teams), body);
}
