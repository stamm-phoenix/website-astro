import type { AbrechnungPerson } from './abrechnung';
export interface AbrechnungEingabe {
  session: AbrechnungSession;
  etag: string | null;
  savedAt: string | null;
  deleteAfter: string | null;
}

/** A block of the Zeitplan, e.g. 8:00–9:00 Frühstück. */
export interface ZeitBlock {
  /** Random ID, keeps a block apart while it is moved. */
  id: string;
  /** `HH:MM` or empty, e.g. for something that takes all day. */
  von: string;
  /** `HH:MM` or empty for an open end or a single point in time. */
  bis: string;
  text: string;
}

export interface ZeitplanTag {
  /** `YYYY-MM-DD` */
  datum: string;
  bloecke: ZeitBlock[];
}

/** The Kurzbeschreibung the KJR asks for with the grant: a sentence and a rough Zeitplan. */
export interface Kurzbeschreibung {
  einleitung: string;
  /** Empty until something was entered; the page shows the days of the Aktion until then. */
  tage: ZeitplanTag[];
}

export const MAX_ZEITPLAN_TAGE = 31;
export const MAX_ZEITBLOECKE_PRO_TAG = 30;
export const MAX_ZEITBLOCK_TEXT = 200;
export const MAX_EINLEITUNG = 2_000;

interface LeihgebuehrEingabe {
  count: number;
  days: number | null;
}
export interface AbrechnungSession {
  zusatztag: boolean;
  /** CampFlow person IDs left out of the Abrechnung. */
  excluded: Record<string, true>;
  /** Persons added on the page. */
  extra: AbrechnungPerson[];
  /** Persons under 27 entered as Betreuer*in, by ID; from 27 on everyone is one anyway. */
  betreuer: Record<string, true>;
  /** Postleitzahlen entered on the page instead of CampFlow's, by person ID (raw input). */
  plz: Record<string, string>;
  /** Header of the KJR's Teilnahmeliste that CampFlow does not know. */
  kjr: { ort: string; plz: string; beginn: string; ende: string };
  /** Material borrowed from the Stamm, by `id` of the material in `Abrechnung.leihgebuehren`. */
  leihgebuehren: Record<string, LeihgebuehrEingabe>;
  /** Names on the Deckblatt. */
  deckblatt: { vorkalkulation: string; kalkulation: string };
  /** Amounts of Einzelnachweise changed on the page, in cent, by `NachweisZeile.key`. */
  betraege: Record<string, number>;
  kurzbeschreibung: Kurzbeschreibung;
}

export function emptySession(): AbrechnungSession {
  return {
    zusatztag: false,
    excluded: {},
    extra: [],
    betreuer: {},
    plz: {},
    kjr: { ort: '', plz: '', beginn: '', ende: '' },
    leihgebuehren: {},
    deckblatt: { vorkalkulation: '', kalkulation: '' },
    betraege: {},
    kurzbeschreibung: { einleitung: '', tage: [] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of a stored object that fit, converted by `pick` (`undefined` drops one). */
function pickEntries<T>(
  value: unknown,
  pick: (entry: unknown) => T | undefined
): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const picked = pick(entry);
      return picked === undefined ? [] : [[key, picked] as const];
    })
  );
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trueOnly(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const GENDERS = ['m', 'w', 'd', ''] as const;
const HERKUNFT = ['landkreis', 'stadt', 'andere', 'unbekannt'] as const;

/** A person added on the page, as stored; `null` if it does not fit. */
function parsePerson(value: unknown): AbrechnungPerson | null {
  if (!isRecord(value)) return null;
  const { id, lastName, firstName, gender, age, plz, ort, herkunft, betreuer } = value;
  const validGender = GENDERS.find((g) => g === gender);
  const validHerkunft = HERKUNFT.find((h) => h === herkunft);
  if (
    typeof id !== 'string' ||
    !id.startsWith('extra-') ||
    typeof lastName !== 'string' ||
    typeof firstName !== 'string' ||
    validGender === undefined ||
    !(age === null || isCount(age)) ||
    typeof plz !== 'string' ||
    !(ort === undefined || typeof ort === 'string') ||
    validHerkunft === undefined ||
    typeof betreuer !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    lastName,
    firstName,
    gender: validGender,
    age,
    plz,
    ...(ort === undefined ? {} : { ort }),
    herkunft: validHerkunft,
    betreuer,
  };
}

function parseLeihgebuehr(value: unknown): LeihgebuehrEingabe | undefined {
  if (!isRecord(value)) return undefined;
  const { count, days } = value;
  return isCount(count) && (days === null || isCount(days)) ? { count, days } : undefined;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function parseZeitBlock(value: unknown): ZeitBlock | null {
  if (!isRecord(value)) return null;
  const { id, von, bis, text } = value;
  if (
    typeof id !== 'string' ||
    !BLOCK_ID_PATTERN.test(id) ||
    typeof von !== 'string' ||
    !(von === '' || TIME_PATTERN.test(von)) ||
    typeof bis !== 'string' ||
    !(bis === '' || TIME_PATTERN.test(bis)) ||
    typeof text !== 'string' ||
    text.length > MAX_ZEITBLOCK_TEXT
  ) {
    return null;
  }
  return { id, von, bis, text };
}

function parseZeitplanTag(value: unknown): ZeitplanTag | null {
  if (!isRecord(value) || typeof value.datum !== 'string' || !DATE_PATTERN.test(value.datum))
    return null;
  return {
    datum: value.datum,
    bloecke: Array.isArray(value.bloecke)
      ? value.bloecke
          .map(parseZeitBlock)
          .filter((b): b is ZeitBlock => b !== null)
          .slice(0, MAX_ZEITBLOECKE_PRO_TAG)
      : [],
  };
}

function parseKurzbeschreibung(value: unknown): Kurzbeschreibung {
  if (!isRecord(value)) return { einleitung: '', tage: [] };
  const einleitung = pickString(value.einleitung);
  return {
    einleitung: einleitung.length > MAX_EINLEITUNG ? '' : einleitung,
    tage: Array.isArray(value.tage)
      ? value.tage
          .map(parseZeitplanTag)
          .filter((t): t is ZeitplanTag => t !== null)
          .slice(0, MAX_ZEITPLAN_TAGE)
      : [],
  };
}

/** Rebuilds a stored session; fields that do not fit are left empty instead. */
export function parseSession(value: unknown): AbrechnungSession {
  if (!isRecord(value)) return emptySession();
  const kjr = isRecord(value.kjr) ? value.kjr : {};
  const deckblatt = isRecord(value.deckblatt) ? value.deckblatt : {};
  return {
    zusatztag: value.zusatztag === true,
    excluded: pickEntries(value.excluded, trueOnly),
    extra: Array.isArray(value.extra)
      ? value.extra.map(parsePerson).filter((p): p is AbrechnungPerson => p !== null)
      : [],
    betreuer: pickEntries(value.betreuer, trueOnly),
    plz: pickEntries(value.plz, (entry) => (typeof entry === 'string' ? entry : undefined)),
    kjr: {
      ort: pickString(kjr.ort),
      plz: pickString(kjr.plz),
      beginn: pickString(kjr.beginn),
      ende: pickString(kjr.ende),
    },
    leihgebuehren: pickEntries(value.leihgebuehren, parseLeihgebuehr),
    deckblatt: {
      vorkalkulation: pickString(deckblatt.vorkalkulation),
      kalkulation: pickString(deckblatt.kalkulation),
    },
    betraege: pickEntries(value.betraege, (entry) =>
      typeof entry === 'number' && Number.isInteger(entry) ? entry : undefined
    ),
    kurzbeschreibung: parseKurzbeschreibung(value.kurzbeschreibung),
  };
}

/** JSON of everything but the Kurzbeschreibung, whose own limits bound its size. */
const MAX_SESSION_JSON = 100_000;
/**
 * JSON of the whole session: a full Kurzbeschreibung (31 days of 30 blocks of 200 characters)
 * stays well below, even with every character escaped.
 */
const MAX_SESSION_JSON_TOTAL = 2_000_000;

/** Whether a session from the browser is small enough to be checked and stored. */
export function sessionSizeOk(value: Record<string, unknown>): boolean {
  return (
    JSON.stringify(value).length <= MAX_SESSION_JSON_TOTAL &&
    JSON.stringify({ ...value, kurzbeschreibung: null }).length <= MAX_SESSION_JSON
  );
}

/** Reject malformed input rather than silently deleting fields during persistence. */
export function validAbrechnungSession(value: unknown): value is AbrechnungSession {
  function canonical(input: unknown): string {
    if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
    if (isRecord(input))
      return (
        '{' +
        Object.keys(input)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(input[key]))
          .join(',') +
        '}'
      );
    return JSON.stringify(input);
  }
  if (!isRecord(value) || !sessionSizeOk(value)) return false;
  // Pages opened before the Kurzbeschreibung existed send sessions without it
  const complete =
    value.kurzbeschreibung === undefined
      ? { ...value, kurzbeschreibung: emptySession().kurzbeschreibung }
      : value;
  return canonical(parseSession(complete)) === canonical(complete);
}
