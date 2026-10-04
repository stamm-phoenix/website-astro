import type { CampflowEvent, CampflowPerson } from './campflow';
import { KJR_BETREUER_AGE, kjrHerkunft } from './kjr-zuschuss';
import type { KjrHerkunft } from './kjr-zuschuss';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WITHOUT_CATEGORY = 'Ohne Kategorie';

/** The fields of an Einzelnachweis the overview needs (see `playwright-api.ts`). */
export interface Buchung {
  category: string | null;
  /** Income is positive, expenses are negative. */
  amountEur: number;
}

export interface KategorieSumme {
  category: string;
  /** Always positive, also for expenses. */
  cent: number;
  count: number;
}

export interface Bilanz {
  incomeCent: number;
  /** Positive sum of all expenses. */
  expenseCent: number;
  resultCent: number;
  income: KategorieSumme[];
  expenses: KategorieSumme[];
  entryCount: number;
}

export interface PersonenZahlen {
  /** Confirmed, not cancelled registrations. */
  total: number;
  /** Teilnehmende for the KJR. */
  under27: number;
  /** Betreuer*innen for the KJR. */
  from27: number;
  /** Without birthdate or age; counted in `total` only. */
  unknownAge: number;
  /**
   * Teilnehmende (not Betreuer*innen) without a Postleitzahl in the Landkreis Rosenheim; the KJR
   * does not subsidise them.
   */
  outsideLandkreis: number;
  /** Persons the KJR grant is calculated for: all Betreuer*innen, Teilnehmende from the Landkreis. */
  subsidised: number;
}

/** A confirmed registration as the KJR's Teilnahmeliste needs it. */
export interface KjrPerson {
  lastName: string;
  firstName: string;
  /** `m`, `w` or `d` as in the list; empty if unknown. */
  gender: 'm' | 'w' | 'd' | '';
  /** On the first day of the Aktion. */
  age: number | null;
  plz: string;
  herkunft: KjrHerkunft;
  /** From 27 on, the KJR counts a person as Betreuer*in. */
  betreuer: boolean;
}

function toCent(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function sumByCategory(entries: { category: string; cent: number }[]): KategorieSumme[] {
  const sums = new Map<string, KategorieSumme>();
  for (const { category, cent } of entries) {
    const sum = sums.get(category) ?? { category, cent: 0, count: 0 };
    sum.cent += cent;
    sum.count++;
    sums.set(category, sum);
  }
  return [...sums.values()].sort(
    (a, b) => b.cent - a.cent || a.category.localeCompare(b.category, 'de')
  );
}

/** Income and expenses per category, like the sheets „Übersicht“ and „Daten für Zuschussantrag“. */
export function summarizeEntries(entries: Buchung[]): Bilanz {
  const rows = entries.map((entry) => ({
    category: entry.category?.trim() || WITHOUT_CATEGORY,
    cent: toCent(entry.amountEur),
  }));
  const income = sumByCategory(rows.filter((row) => row.cent > 0));
  const expenses = sumByCategory(
    rows.filter((row) => row.cent < 0).map((row) => ({ ...row, cent: -row.cent }))
  );
  const incomeCent = income.reduce((sum, row) => sum + row.cent, 0);
  const expenseCent = expenses.reduce((sum, row) => sum + row.cent, 0);
  return {
    incomeCent,
    expenseCent,
    resultCent: incomeCent - expenseCent,
    income,
    expenses,
    entryCount: entries.length,
  };
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** Age in full years on `reference` (`YYYY-MM-DD`), from the birthdate or else CampFlow's age. */
export function ageAt(person: CampflowPerson, reference: string | null): number | null {
  const birthdate = typeof person.birthdate === 'string' ? person.birthdate.slice(0, 10) : '';
  const ref = reference?.slice(0, 10) ?? '';
  if (!DATE_PATTERN.test(birthdate) || !DATE_PATTERN.test(ref)) {
    return typeof person.age === 'number' ? person.age : null;
  }
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ry, rm, rd] = ref.split('-').map(Number);
  return ry - by - (rm < bm || (rm === bm && rd < bd) ? 1 : 0);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isConfirmed(person: CampflowPerson): boolean {
  return !isFilled(person.cancellation_date) && isFilled(person.confirmation_date);
}

/** CampFlow's postal address (`address.zip`); other spellings just in case. */
export function postalCode(person: CampflowPerson): string {
  const address = person.address as Record<string, unknown> | null | undefined;
  const value =
    (address && typeof address === 'object' ? (address.zip ?? address.postal_code) : undefined) ??
    person.zip ??
    person.postal_code;
  return typeof value === 'number' ? String(value) : text(value);
}

const GENDERS: Record<string, KjrPerson['gender']> = {
  f: 'w',
  w: 'w',
  female: 'w',
  weiblich: 'w',
  m: 'm',
  male: 'm',
  männlich: 'm',
  d: 'd',
  diverse: 'd',
  divers: 'd',
};

/** The confirmed registrations, sorted by name, with the fields of the KJR's Teilnahmeliste. */
export function kjrPersons(persons: CampflowPerson[], startDate: string | null): KjrPerson[] {
  return persons
    .filter(isConfirmed)
    .map((person) => {
      const name = (person.name ?? {}) as { first_name?: unknown; last_name?: unknown };
      const age = ageAt(person, startDate);
      const plz = postalCode(person);
      return {
        lastName: text(name.last_name),
        firstName: text(name.first_name),
        gender: GENDERS[text(person.gender).toLowerCase()] ?? '',
        age,
        plz,
        herkunft: kjrHerkunft(plz),
        betreuer: age !== null && age >= KJR_BETREUER_AGE,
      };
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
    );
}

/** Counts the confirmed registrations, split at the KJR's age limit on the first day. */
export function countPersons(persons: CampflowPerson[], startDate: string | null): PersonenZahlen {
  const counts: PersonenZahlen = {
    total: 0,
    under27: 0,
    from27: 0,
    unknownAge: 0,
    outsideLandkreis: 0,
    subsidised: 0,
  };
  for (const person of kjrPersons(persons, startDate)) {
    counts.total++;
    if (person.age === null) counts.unknownAge++;
    else if (person.betreuer) counts.from27++;
    else counts.under27++;
    if (person.betreuer || person.herkunft === 'landkreis') counts.subsidised++;
    else counts.outsideLandkreis++;
  }
  return counts;
}

// CampFlow's public API does not document a Kostenstelle on events; should it ever send one,
// it is preferred over the title.
const COST_UNIT_FIELDS = ['cost_unit', 'costunit', 'cost_unit_id', 'costunit_id'];

/** The Kostenstelle to look up for an event: a linked one if CampFlow sends it, else the title. */
export function costUnitForEvent(event: CampflowEvent): string {
  for (const field of COST_UNIT_FIELDS) {
    const value = event[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const { id, name } = value as { id?: unknown; name?: unknown };
      if (typeof id === 'string' && id.trim()) return id.trim();
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return event.title.trim();
}
