import type { AbrechnungPerson } from './abrechnung';
export interface AbrechnungEingabe {
  session: AbrechnungSession;
  etag: string | null;
  savedAt: string | null;
  deleteAfter: string | null;
}

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
  };
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
  return (
    isRecord(value) &&
    JSON.stringify(value).length <= 100_000 &&
    canonical(parseSession(value)) === canonical(value)
  );
}
