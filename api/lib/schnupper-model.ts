/**
 * Schnupperstunden-Anfragen (#139): the request of a family, its states and the rules of the
 * form. The browser runs the same check (via `web/src/lib/schnupper.ts`), so this file must stay
 * free of zod and Node-specific imports.
 */
import { STUFE_KEYS } from './aktion-stufen';
import type { StufeKey } from './aktion-stufen';

/** A Stufe, or `unklar` when the family does not know which one fits. */
export type SchnupperStufe = StufeKey | 'unklar';

export const SCHNUPPER_STUFEN: readonly SchnupperStufe[] = [
  'woelflinge',
  'jupfis',
  'pfadis',
  'rover',
  'unklar',
];

export const SCHNUPPER_STUFE_LABELS: Record<SchnupperStufe, string> = {
  ...STUFE_KEYS,
  unklar: 'Weiß ich nicht',
};

export const SCHNUPPER_STATUS = ['offen', 'bestaetigt', 'abgesagt'] as const;
export type SchnupperStatus = (typeof SCHNUPPER_STATUS)[number];

export const SCHNUPPER_ALTER = { min: 5, max: 25 } as const;

export const SCHNUPPER_MAX_LENGTH = {
  kindVorname: 60,
  name: 100,
  email: 254,
  telefon: 40,
  wunschzeit: 300,
  nachricht: 2000,
  ort: 200,
  antwort: 2000,
} as const;

/** The Stufe that fits an age, following the age ranges of the Gruppenstunden. */
export function stufeFuerAlter(alter: number): StufeKey {
  if (alter <= 9) return 'woelflinge';
  if (alter <= 12) return 'jupfis';
  if (alter <= 15) return 'pfadis';
  return 'rover';
}

/** What a family sends. */
export interface SchnupperAnfrageInput {
  alter: number;
  stufe: SchnupperStufe;
  /** Optional; empty when not given. */
  kindVorname: string;
  name: string;
  email: string;
  /** Optional; empty when not given. */
  telefon: string;
  wunschzeit: string;
  /** Optional; empty when not given. */
  nachricht: string;
}

export type SchnupperField = keyof SchnupperAnfrageInput;

export interface SchnupperValidation {
  anfrage: SchnupperAnfrageInput | null;
  errors: Partial<Record<SchnupperField, string>>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFON_PATTERN = /^\+?[\d\s/()-]{5,}$/;

/** Trimmed text, `''` for anything but a string. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Text on one line: line breaks would end up in the subject of a mail. */
function line(value: unknown): string {
  return text(value).replace(/\s+/g, ' ');
}

/** The age as a whole number, or `null`; accepts a number or a numeric string. */
function readAlter(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(number) && number >= SCHNUPPER_ALTER.min && number <= SCHNUPPER_ALTER.max
    ? number
    : null;
}

function isSchnupperStufe(value: unknown): value is SchnupperStufe {
  return typeof value === 'string' && (SCHNUPPER_STUFEN as readonly string[]).includes(value);
}

/**
 * Checks a request of the public form. Returns the trimmed request, or `null` with a German
 * message per invalid field. Extra fields are ignored.
 */
export function validateSchnupperAnfrage(input: Record<string, unknown>): SchnupperValidation {
  const errors: SchnupperValidation['errors'] = {};
  const max = SCHNUPPER_MAX_LENGTH;

  const alter = readAlter(input.alter);
  if (alter === null)
    errors.alter = `Bitte gib das Alter in Jahren an (${SCHNUPPER_ALTER.min} bis ${SCHNUPPER_ALTER.max}).`;

  const stufe = isSchnupperStufe(input.stufe) ? input.stufe : null;
  if (stufe === null) errors.stufe = 'Bitte wähle eine Stufe oder „Weiß ich nicht“.';

  const kindVorname = line(input.kindVorname);
  if (kindVorname.length > max.kindVorname)
    errors.kindVorname = `Der Vorname darf höchstens ${max.kindVorname} Zeichen lang sein.`;

  const name = line(input.name);
  if (name === '') errors.name = 'Bitte gib deinen Namen an.';
  else if (name.length > max.name)
    errors.name = `Dein Name darf höchstens ${max.name} Zeichen lang sein.`;

  const email = text(input.email);
  if (email.length > max.email || !EMAIL_PATTERN.test(email))
    errors.email = 'Bitte gib eine gültige E-Mail-Adresse an.';

  const telefon = line(input.telefon);
  if (telefon !== '' && (telefon.length > max.telefon || !TELEFON_PATTERN.test(telefon)))
    errors.telefon = 'Bitte gib eine gültige Telefonnummer an oder lass das Feld leer.';

  const wunschzeit = text(input.wunschzeit);
  if (wunschzeit === '') errors.wunschzeit = 'Bitte schreib, wann du kommen möchtest.';
  else if (wunschzeit.length > max.wunschzeit)
    errors.wunschzeit = `Die Wunschzeit darf höchstens ${max.wunschzeit} Zeichen lang sein.`;

  const nachricht = text(input.nachricht);
  if (nachricht.length > max.nachricht)
    errors.nachricht = `Deine Nachricht darf höchstens ${max.nachricht} Zeichen lang sein.`;

  if (Object.keys(errors).length > 0 || alter === null || stufe === null) {
    return { anfrage: null, errors };
  }
  return {
    anfrage: { alter, stufe, kindVorname, name, email, telefon, wunschzeit, nachricht },
    errors,
  };
}

/** A request as the Leitendenbereich shows it. */
export interface StaffSchnupperAnfrage extends SchnupperAnfrageInput {
  id: number;
  etag: string;
  createdAt: string;
  status: SchnupperStatus;
  /** The confirmed date (`YYYY-MM-DD`, Berlin) and time (`HH:MM`); only when confirmed. */
  termin: { datum: string; zeit: string; ort: string } | null;
  /** The text of the last answer to the family. */
  antwort: string;
  /** Whether the last answer reached the family by mail; `null` before the first answer. */
  antwortMail: boolean | null;
  bearbeitetVon: string | null;
  bearbeitetAm: string | null;
}

/** A confirmed date for the Schnupperstunde. */
export interface SchnupperBestaetigung {
  datum: string;
  zeit: string;
  ort: string;
  antwort: string;
}

/** A cancellation with an optional text to the family. */
export interface SchnupperAbsage {
  antwort: string;
}

/** The result of an answer: whether the mail reached the family. */
export interface SchnupperAntwortErgebnis {
  anfrage: StaffSchnupperAnfrage;
  mailSent: boolean;
}
