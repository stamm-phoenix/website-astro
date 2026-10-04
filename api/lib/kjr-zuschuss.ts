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
