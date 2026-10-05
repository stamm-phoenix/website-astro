// Rules of the Kreisjugendring Rosenheim (KJR) for the grant of an Aktion. Shared with the
// frontend (web/src/lib/kjrZuschuss.ts), which recalculates it live; keep it free of imports.

/** Grant per person and day of an Aktion with overnight stays. */
export const KJR_RATE_MULTI_DAY_CENT = 800;
/** Grant per person of an Aktion without overnight stay. */
export const KJR_RATE_SINGLE_DAY_CENT = 500;
/** From this age on, the KJR counts a person as Betreuer*in instead of Teilnehmer*in. */
export const KJR_BETREUER_AGE = 27;
/** More Teilnehmende per Betreuer*in than this has to be explained in the application. */
export const KJR_MAX_TEILNEHMENDE_PER_BETREUER = 8;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Overnight stays between two dates (`YYYY-MM-DD`); 0 if a date is missing. */
export function countNights(start: string | null, end: string | null): number {
  if (
    !start ||
    !end ||
    !DATE_PATTERN.test(start.slice(0, 10)) ||
    !DATE_PATTERN.test(end.slice(0, 10))
  ) {
    return 0;
  }
  const nights = Math.round(
    (Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  );
  return Math.max(0, nights);
}

export interface KjrZuschussInput {
  /** All persons, Teilnehmende and Betreuer*innen. */
  persons: number;
  nights: number;
  /** More than six hours of programme on the days of arrival and departure: one more day. */
  zusatztag: boolean;
  /** Income minus expenses before the grant. */
  resultCent: number;
}

export interface KjrZuschuss {
  rateCent: number;
  /** Days the rate is paid for; 1 for an Aktion without overnight stay. */
  days: number;
  /** Grant according to the formula, regardless of the result. */
  computedCent: number;
  deficitCent: number;
  /** Grant that can be applied for: only for a deficit and at most its amount. */
  eligibleCent: number;
  resultAfterCent: number;
}

export function kjrZuschuss({
  persons,
  nights,
  zusatztag,
  resultCent,
}: KjrZuschussInput): KjrZuschuss {
  const multiDay = nights > 0;
  const rateCent = multiDay ? KJR_RATE_MULTI_DAY_CENT : KJR_RATE_SINGLE_DAY_CENT;
  const days = multiDay ? nights + (zusatztag ? 1 : 0) : 1;
  const computedCent = rateCent * Math.max(0, persons) * days;
  const deficitCent = Math.max(0, -resultCent);
  const eligibleCent = Math.min(computedCent, deficitCent);
  return {
    rateCent,
    days,
    computedCent,
    deficitCent,
    eligibleCent,
    resultAfterCent: resultCent + eligibleCent,
  };
}

export interface Betreuungsschluessel {
  /** E.g. `1:7,5`, or `–` without Teilnehmende. */
  label: string;
  /** Worse than 1:8 or no Betreuer*in at all: has to be explained to the KJR. */
  warning: boolean;
}

export function betreuungsschluessel(
  teilnehmende: number,
  betreuende: number
): Betreuungsschluessel {
  if (teilnehmende <= 0) return { label: '–', warning: false };
  if (betreuende <= 0) return { label: `0:${teilnehmende}`, warning: true };
  const ratio = Math.round((teilnehmende / betreuende) * 10) / 10;
  return {
    label: `1:${String(ratio).replace('.', ',')}`,
    warning: teilnehmende / betreuende > KJR_MAX_TEILNEHMENDE_PER_BETREUER,
  };
}

/**
 * Postleitzahlen of the Landkreis Rosenheim, as in the KJR's Teilnahmeliste (sheet
 * „Hilfstabellen“). Only Teilnehmende from there are subsidised; Betreuer*innen always count.
 */
export const LANDKREIS_ROSENHEIM_PLZ: readonly string[] = [
  '83043',
  '83052',
  '83059',
  '83064',
  '83071',
  '83075',
  '83080',
  '83083',
  '83088',
  '83093',
  '83098',
  '83101',
  '83104',
  '83109',
  '83112',
  '83115',
  '83122',
  '83123',
  '83125',
  '83126',
  '83128',
  '83129',
  '83131',
  '83134',
  '83135',
  '83137',
  '83139',
  '83209',
  '83229',
  '83233',
  '83253',
  '83254',
  '83256',
  '83257',
  '83512',
  '83533',
  '83539',
  '83543',
  '83544',
  '83547',
  '83549',
  '83552',
  '83556',
  '83561',
  '83564',
  '83569',
  '83620',
];

/** Postleitzahlen of the kreisfreie Stadt Rosenheim, listed separately by the KJR. */
export const STADT_ROSENHEIM_PLZ: readonly string[] = ['83022', '83024', '83026'];

export type KjrHerkunft = 'landkreis' | 'stadt' | 'andere' | 'unbekannt';

/** Where a person lives as the KJR's Teilnahmeliste sorts it, by Postleitzahl. */
export function kjrHerkunft(plz: string | null | undefined): KjrHerkunft {
  const value = plz?.trim() ?? '';
  if (!/^\d{5}$/.test(value)) return 'unbekannt';
  if (LANDKREIS_ROSENHEIM_PLZ.includes(value)) return 'landkreis';
  if (STADT_ROSENHEIM_PLZ.includes(value)) return 'stadt';
  return 'andere';
}

/** The fields of a person the Abrechnung and the KJR's Teilnahmeliste work with. */
export interface KjrPersonInput {
  lastName: string;
  firstName: string;
  /** `m`, `w` or `d` as in the list; empty if unknown. */
  gender: 'm' | 'w' | 'd' | '';
  /** On the first day of the Aktion. */
  age: number | null;
  plz: string;
  /** Where the person lives, as written in CampFlow; empty if unknown. */
  ort?: string;
  /** Entered as Betreuer*in on the page; only matters under 27. */
  betreuer?: boolean;
}

export interface KjrPerson extends KjrPersonInput {
  herkunft: KjrHerkunft;
  /** Betreuer*in for the KJR: always from 27 on, younger ones when entered as such. */
  betreuer: boolean;
}

/** From 27 on, the KJR only accepts a person as Betreuer*in, never as Teilnehmer*in. */
export function isKjrBetreuerAge(age: number | null): boolean {
  return age !== null && age >= KJR_BETREUER_AGE;
}

/** The KJR's role of a person: from 27 always Betreuer*in, younger ones as chosen. */
export function isKjrBetreuer(age: number | null, chosen: boolean | undefined): boolean {
  return isKjrBetreuerAge(age) || chosen === true;
}

export function toKjrPerson(input: KjrPersonInput): KjrPerson {
  return {
    ...input,
    plz: input.plz.trim(),
    herkunft: kjrHerkunft(input.plz),
    betreuer: isKjrBetreuer(input.age, input.betreuer),
  };
}

export interface KjrPersonenZahlen {
  total: number;
  /** Teilnehmende for the KJR: under 27 and not entered as Betreuer*in. */
  teilnehmende: number;
  /** Betreuer*innen for the KJR: everyone from 27, younger ones entered as Betreuer*in. */
  betreuende: number;
  /** Persons from 27 on. */
  ab27: number;
  /** Teilnehmende without age; counted in `total` only. */
  unknownAge: number;
  /** Teilnehmende without a Postleitzahl in the Landkreis Rosenheim: not subsidised. */
  outsideLandkreis: number;
  /** Persons the KJR grant is calculated for: all Betreuer*innen, Teilnehmende from the Landkreis. */
  subsidised: number;
}

export function countKjrPersons(persons: KjrPerson[]): KjrPersonenZahlen {
  const counts: KjrPersonenZahlen = {
    total: 0,
    teilnehmende: 0,
    betreuende: 0,
    ab27: 0,
    unknownAge: 0,
    outsideLandkreis: 0,
    subsidised: 0,
  };
  for (const person of persons) {
    counts.total++;
    if (isKjrBetreuerAge(person.age)) counts.ab27++;
    if (person.betreuer) counts.betreuende++;
    else if (person.age === null) counts.unknownAge++;
    else counts.teilnehmende++;
    if (person.betreuer || person.herkunft === 'landkreis') counts.subsidised++;
    else counts.outsideLandkreis++;
  }
  return counts;
}
