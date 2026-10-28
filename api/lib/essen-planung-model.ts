import type { Gericht, PlanungZutat } from './essen-gerichte-model';
import type { FieldErrors } from './validation/errors';
import { ValidationError } from './validation/errors';

/**
 * Types, rules and checks of a Planung of the Essensplanung without database access, so the
 * mock API of the website uses the same ones (`docs/essensplanung.md`).
 */

export type PlanungRolle = 'besitzer' | 'bearbeiten';

/** What the link in the request allows: a member's own link or the shared read-only link. */
export type PlanungZugang = PlanungRolle | 'lesen';

/** At most this many days per Planung; a camp of two weeks with buffer. */
export const MAX_TAGE = 60;
/** Also the limit of the template, so a day from the template can always take a replacement. */
export const MAX_MAHLZEITEN_PRO_TAG = 20;
export const MAX_MITGLIEDER = 50;
/** Dishes per meal, e.g. main course, dessert and a replacement. */
export const MAX_EINPLANUNGEN_PRO_MAHLZEIT = 10;
export const MAX_FAKTOR = 20;

/** Unconfirmed requests to create a Planung expire after this time. */
export const ANFRAGE_GUELTIG_MS = 24 * 60 * 60_000;
/** Per address at most this many requests to create a Planung per hour. */
export const ANFRAGEN_PRO_STUNDE = 3;
/** „Meine Planungen“ and new links: at most one mail per member in this time. */
export const LINK_WARTEZEIT_MS = 10 * 60_000;
/** The owners are warned this many days before a Planung is deleted. */
export const LOESCHWARNUNG_TAGE = 14;

export interface PlanungMitglied {
  id: number;
  etag: string;
  name: string;
  rolle: PlanungRolle;
  /** Only for those who manage the members. */
  email: string | null;
  entzogen: boolean;
  ich: boolean;
}

/** A dish planned at a meal. */
export interface Einplanung {
  id: number;
  etag: string;
  gerichtId: number;
  /** Order within the meal, from 1. */
  position: number;
  /** The amounts of the dish times this, e.g. 0.5 when only half eat the dessert. */
  faktor: number;
  /** A member of the Planung, or null. */
  zustaendigId: number | null;
  /** The shown name of who is responsible: the member's or a free one; empty for nobody. */
  zustaendig: string;
}

export interface PlanungMahlzeit {
  id: number;
  etag: string;
  position: number;
  /** Shown ID `<Tag>_<Slot>`, e.g. `3_1`; follows the current order. */
  kennung: string;
  name: string;
  /** `HH:MM` or null. */
  uhrzeit: string | null;
  einplanungen: Einplanung[];
}

export interface PlanungTag {
  id: number;
  etag: string;
  /** `YYYY-MM-DD`. */
  datum: string;
  /** Tag 1 is the earliest day. */
  nummer: number;
  mahlzeiten: PlanungMahlzeit[];
}

export interface PlanungAenderung {
  seq: number;
  at: string;
  wer: string;
  aktion: string;
  details: Record<string, unknown>;
}

/** Everything a page of a Planung shows. */
export interface PlanungAnsicht {
  id: number;
  etag: string;
  name: string;
  seq: number;
  /**
   * What the page polls with: the change counter and the version of the Steuerung, so the end of
   * the maintenance mode or a new retention reaches open pages too.
   */
  stand: string;
  zugang: PlanungZugang;
  /** The member whose link is used; null for the read-only link. */
  ichId: number | null;
  /** Whether this link may invite and manage members and the shared links. */
  darfVerwalten: boolean;
  mitgliederVerwalten: boolean;
  /** Shared links (tokens), only for those who manage; null while switched off. */
  links: { beitritt: string | null; lesen: string | null } | null;
  tage: PlanungTag[];
  mitglieder: PlanungMitglied[];
  /** When the Planung will be deleted (`YYYY-MM-DD`), from its last day and the retention. */
  loeschtAm: string | null;
  /** Changes are refused while the Steuerung's maintenance mode is on. */
  wartung: boolean;
  /** The latest changes, newest first. */
  aenderungen: PlanungAenderung[];
  /** Version of the central lists; a new one means the page loads them again. */
  katalogStand: string;
  /** Ingredients used in the Planung, by name. */
  zutaten: PlanungZutat[];
  /** Dishes by name, with their lines in order. */
  gerichte: Gericht[];
}

/** Whether `zugang` may change the plan (days, meals, later dishes). */
export function darfBearbeiten(zugang: PlanungZugang): boolean {
  return zugang === 'besitzer' || zugang === 'bearbeiten';
}

/** Whether `zugang` may invite and remove members and manage the shared links. */
export function darfMitgliederVerwalten(
  zugang: PlanungZugang,
  mitgliederVerwalten: boolean
): boolean {
  return zugang === 'besitzer' || (zugang === 'bearbeiten' && mitgliederVerwalten);
}

/** Adds the shown IDs and day numbers to days sorted by date and meals sorted by position. */
export function nummeriereTage(
  tage: Omit<PlanungTag, 'nummer' | 'mahlzeiten'>[],
  mahlzeiten: (Omit<PlanungMahlzeit, 'kennung'> & { tagId: number })[]
): PlanungTag[] {
  return [...tage]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((tag, index) => ({
      ...tag,
      nummer: index + 1,
      mahlzeiten: mahlzeiten
        .filter((mahlzeit) => mahlzeit.tagId === tag.id)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((mahlzeit, slot) => ({
          id: mahlzeit.id,
          etag: mahlzeit.etag,
          name: mahlzeit.name,
          uhrzeit: mahlzeit.uhrzeit,
          position: mahlzeit.position,
          kennung: `${index + 1}_${slot + 1}`,
          einplanungen: [...mahlzeit.einplanungen].sort(
            (a, b) => a.position - b.position || a.id - b.id
          ),
        })),
    }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A valid calendar date `YYYY-MM-DD`, or undefined. */
export function readDatum(value: unknown): string | undefined {
  if (typeof value !== 'string' || !DATE.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

export function addDays(datum: string, days: number): string {
  const date = new Date(`${datum}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60_000)
  );
}

/** The day a Planung is deleted: its last day plus the retention in months. */
export function loeschDatum(letzterTag: string, monate: number): string {
  const date = new Date(`${letzterTag}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + monate);
  // The 31st becomes the last day of a shorter month
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(
  value: unknown,
  max: number,
  errors: FieldErrors,
  field: string,
  message = 'Bitte ausfüllen.'
): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) errors[field] = message;
  else if (text.length > max) errors[field] = `Höchstens ${max} Zeichen.`;
  return text;
}

const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/;

function readEmail(
  value: unknown,
  errors: FieldErrors,
  field: string,
  required: boolean
): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) {
    if (required) errors[field] = 'Bitte eine Mailadresse eintragen.';
    return null;
  }
  if (email.length > 254 || !EMAIL.test(email)) {
    errors[field] = 'Bitte eine gültige Mailadresse eintragen, z. B. name@beispiel.de.';
  }
  return email;
}

function fail(errors: FieldErrors): void {
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

export interface AnlegenInput {
  email: string;
  name: string;
  planungName: string;
  ersterTag: string;
  letzterTag: string;
}

export function validateAnlegen(input: unknown): AnlegenInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const email = readEmail(value.email, errors, 'email', true) ?? '';
  const name = readText(value.name, 100, errors, 'name', 'Bitte deinen Namen eintragen.');
  const planungName = readText(
    value.planungName,
    150,
    errors,
    'planungName',
    'Bitte einen Namen für die Planung eintragen, z. B. „Sommerlager 2027“.'
  );
  const ersterTag = readDatum(value.ersterTag);
  const letzterTag = readDatum(value.letzterTag);
  if (!ersterTag) errors.ersterTag = 'Bitte den ersten Tag wählen.';
  if (!letzterTag) errors.letzterTag = 'Bitte den letzten Tag wählen.';
  if (ersterTag && letzterTag) {
    const tage = daysBetween(ersterTag, letzterTag) + 1;
    if (tage < 1) errors.letzterTag = 'Der letzte Tag liegt vor dem ersten.';
    else if (tage > MAX_TAGE) errors.letzterTag = `Höchstens ${MAX_TAGE} Tage.`;
  }
  fail(errors);
  return { email, name, planungName, ersterTag: ersterTag!, letzterTag: letzterTag! };
}

export function validateMitgliedName(input: unknown): string {
  const errors: FieldErrors = {};
  const name = readText(
    isRecord(input) ? input.name : undefined,
    100,
    errors,
    'name',
    'Bitte einen Namen eintragen.'
  );
  fail(errors);
  return name;
}

export interface BeitrittInput {
  name: string;
  email: string | null;
}

export function validateBeitritt(input: unknown): BeitrittInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const name = readText(value.name, 100, errors, 'name', 'Bitte deinen Namen eintragen.');
  const email = readEmail(value.email, errors, 'email', false);
  fail(errors);
  return { name, email };
}

export interface EinladungInput {
  name: string;
  email: string;
  rolle: PlanungRolle;
}

export function validateEinladung(input: unknown): EinladungInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const name = readText(value.name, 100, errors, 'name', 'Bitte einen Namen eintragen.');
  const email = readEmail(value.email, errors, 'email', true) ?? '';
  const rolle = value.rolle === 'besitzer' ? 'besitzer' : 'bearbeiten';
  fail(errors);
  return { name, email, rolle };
}

export function validateEmail(input: unknown): string {
  const errors: FieldErrors = {};
  const email = readEmail(isRecord(input) ? input.email : undefined, errors, 'email', true) ?? '';
  fail(errors);
  return email;
}

/** The fields of the Planung someone changed, each with the value the form started from. */
export interface PlanungEinstellungenInput {
  /** `vorher` is missing when the client sent none; then the field is simply set. */
  name?: { neu: string; vorher?: string };
  mitgliederVerwalten?: { neu: boolean; vorher?: boolean };
}

/**
 * Only the changed fields are sent, with what the form showed before: a field changed by someone
 * else meanwhile is a conflict, fields left alone keep what others saved.
 */
export function validatePlanungEinstellungen(input: unknown): PlanungEinstellungenInput {
  const value = isRecord(input) ? input : {};
  const vorher = isRecord(value.vorher) ? value.vorher : {};
  const errors: FieldErrors = {};
  const result: PlanungEinstellungenInput = {};
  if (value.name !== undefined) {
    const name = readText(value.name, 150, errors, 'name', 'Bitte einen Namen eintragen.');
    result.name = {
      neu: name,
      ...(typeof vorher.name === 'string' ? { vorher: vorher.name } : {}),
    };
  }
  if (value.mitgliederVerwalten !== undefined) {
    if (typeof value.mitgliederVerwalten !== 'boolean') {
      errors.mitgliederVerwalten = 'Bitte ja oder nein wählen.';
    } else {
      result.mitgliederVerwalten = {
        neu: value.mitgliederVerwalten,
        ...(typeof vorher.mitgliederVerwalten === 'boolean'
          ? { vorher: vorher.mitgliederVerwalten }
          : {}),
      };
    }
  }
  if (!result.name && !result.mitgliederVerwalten && !Object.keys(errors).length) {
    errors.name = 'Es gibt nichts zu speichern.';
  }
  fail(errors);
  return result;
}

export function validateTag(input: unknown): string {
  const errors: FieldErrors = {};
  const datum = readDatum(isRecord(input) ? input.datum : undefined);
  if (!datum) errors.datum = 'Bitte ein Datum wählen.';
  fail(errors);
  return datum!;
}

export interface MahlzeitInput {
  name: string;
  uhrzeit: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateMahlzeit(input: unknown): MahlzeitInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const name = readText(value.name, 50, errors, 'name', 'Bitte einen Namen eintragen.');
  let uhrzeit: string | null = null;
  if (typeof value.uhrzeit === 'string' && value.uhrzeit.trim()) {
    uhrzeit = value.uhrzeit.trim().slice(0, 5);
    if (!TIME.test(uhrzeit)) errors.uhrzeit = 'Bitte eine Uhrzeit wie 12:30 eintragen.';
  }
  fail(errors);
  return { name, uhrzeit };
}

/** A position (1-based) for moving a meal within its day, or undefined. */
export function readPosition(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : undefined;
}

/**
 * The newest of some versions (rowversions grow with every change). A whole that is deleted
 * with it, e.g. a meal with its dishes, fails after any change of one of its parts.
 */
export function neuesteVersion(etags: string[]): string {
  return etags.reduce((neueste, etag) => (etag > neueste ? etag : neueste), '');
}

/** The version a meal is deleted with: of the meal and the dishes planned at it. */
export function mahlzeitStand(mahlzeit: PlanungMahlzeit): string {
  return neuesteVersion([mahlzeit.etag, ...mahlzeit.einplanungen.map((e) => e.etag)]);
}

/** The version a day is deleted with: of the day, its meals and their dishes. */
export function tagStand(tag: PlanungTag): string {
  return neuesteVersion([tag.etag, ...tag.mahlzeiten.map(mahlzeitStand)]);
}

/** A dish at a meal, or moved or copied to one; `gerichtId` only when it is added. */
export interface EinplanungInput {
  mahlzeitId: number;
  gerichtId: number;
  faktor: number;
  zustaendigId: number | null;
  zustaendigText: string;
}

export const FAKTOR_FEHLER = `Bitte eine Zahl von 0,001 bis ${MAX_FAKTOR} eintragen, z. B. 0,5.`;

/** A factor as stored: from 0.001 to `MAX_FAKTOR`, three decimals at most (`decimal(6, 3)`). */
export function faktorGueltig(faktor: number): boolean {
  return (
    faktor >= 0.001 &&
    faktor <= MAX_FAKTOR &&
    Math.abs(Math.round(faktor * 1000) - faktor * 1000) < 1e-6
  );
}

/** The factor as typed („0,5“) or sent (0.5); NaN for anything else. */
export function leseFaktor(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

export function validateEinplanung(input: unknown): EinplanungInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const id = (raw: unknown) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
  const mahlzeitId = id(value.mahlzeitId);
  if (mahlzeitId === null) errors.mahlzeitId = 'Bitte eine Mahlzeit wählen.';
  const gerichtId = id(value.gerichtId);
  if (gerichtId === null) errors.gerichtId = 'Bitte ein Gericht wählen.';
  const faktor = value.faktor === undefined ? 1 : leseFaktor(value.faktor);
  if (!faktorGueltig(faktor)) errors.faktor = FAKTOR_FEHLER;
  const zustaendigId = value.zustaendigId === null ? null : id(value.zustaendigId);
  if (value.zustaendigId !== undefined && value.zustaendigId !== null && zustaendigId === null)
    errors.zustaendigId = 'Bitte aus der Liste wählen.';
  const zustaendigText =
    typeof value.zustaendigText === 'string'
      ? value.zustaendigText.trim().replace(/\s+/g, ' ')
      : '';
  if (zustaendigText.length > 100) errors.zustaendigText = 'Höchstens 100 Zeichen.';
  if (zustaendigId !== null && zustaendigText)
    errors.zustaendigText = 'Entweder ein Mitglied oder einen Namen.';
  fail(errors);
  return { mahlzeitId: mahlzeitId!, gerichtId: gerichtId!, faktor, zustaendigId, zustaendigText };
}

/** Shown text of a change, e.g. „Mahlzeit 3_1 umbenannt: Frühstück“. */
export const AENDERUNG_TEXTE: Record<string, string> = {
  'planung-angelegt': 'Planung angelegt',
  'planung-geaendert': 'Einstellungen geändert',
  'tag-neu': 'Tag hinzugefügt',
  'tag-geaendert': 'Tag verschoben',
  'tag-geloescht': 'Tag gelöscht',
  'mahlzeit-neu': 'Mahlzeit hinzugefügt',
  'mahlzeit-geaendert': 'Mahlzeit geändert',
  'mahlzeit-geloescht': 'Mahlzeit gelöscht',
  'mitglied-eingeladen': 'Mitglied eingeladen',
  'mitglied-beigetreten': 'Beigetreten',
  'mitglied-geaendert': 'Mitglied geändert',
  'mitglied-entzogen': 'Zugang entzogen',
  'mitglied-link': 'Neuen Link verschickt',
  'link-beitritt': 'Link zum Beitreten geändert',
  'link-lesen': 'Link zum Ansehen geändert',
  'name-geaendert': 'Eigenen Namen geändert',
  'gericht-neu': 'Gericht angelegt',
  'gericht-geaendert': 'Gericht geändert',
  'gericht-geloescht': 'Gericht gelöscht',
  'gericht-zutat-neu': 'Zutat zu Gericht hinzugefügt',
  'gericht-zutat-geaendert': 'Zutat in Gericht geändert',
  'gericht-zutat-geloescht': 'Zutat aus Gericht entfernt',
  'zutat-neu': 'Eigene Zutat angelegt',
  'zutat-geaendert': 'Zutat der Planung geändert',
  'zutat-geloescht': 'Zutat der Planung gelöscht',
  'einplanung-neu': 'Gericht eingeplant',
  'einplanung-geaendert': 'Einplanung geändert',
  'einplanung-geloescht': 'Gericht aus Mahlzeit entfernt',
};
