import type { CampflowEvent, CampflowPerson } from './campflow';
import { countKjrPersons, toKjrPerson } from './kjr-zuschuss';
import type { KjrPerson, KjrPersonenZahlen } from './kjr-zuschuss';

export type { KjrPersonenZahlen as PersonenZahlen } from './kjr-zuschuss';

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

/** A confirmed registration of the Aktion, with the fields relevant for the Abrechnung. */
export interface AbrechnungPerson extends KjrPerson {
  /** CampFlow's person ID. */
  id: string;
}

/** An Einzelnachweis as shown in the list of the Abrechnung. */
export interface Nachweis {
  receiptNumber: string | null;
  type: string | null;
  description: string | null;
  category: string;
  paidBy: string | null;
  /** `YYYY-MM-DD` */
  date: string | null;
  /** Income is positive, expenses are negative. */
  cent: number;
}

/** The fields of a row of CampFlow's Einzelnachweise the Abrechnung uses. */
export interface NachweisInput extends Buchung {
  receiptNumber?: string | null;
  type?: string | null;
  description?: string | null;
  paidBy?: string | null;
  date?: string | null;
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

function categoryOf(entry: Buchung): string {
  return entry.category?.trim() || WITHOUT_CATEGORY;
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** The single entries, newest first, with amounts in cent. */
export function toNachweise(entries: NachweisInput[]): Nachweis[] {
  return entries
    .map((entry) => ({
      receiptNumber: optionalText(entry.receiptNumber),
      type: optionalText(entry.type),
      description: optionalText(entry.description),
      category: categoryOf(entry),
      paidBy: optionalText(entry.paidBy),
      date: optionalText(entry.date),
      cent: toCent(entry.amountEur),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Income and expenses per category, like the sheets „Übersicht“ and „Daten für Zuschussantrag“. */
export function summarizeEntries(entries: Buchung[]): Bilanz {
  const rows = entries.map((entry) => ({
    category: categoryOf(entry),
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

/** The Postleitzahl of CampFlow's address (`address.postcode`); other spellings just in case. */
export function postalCode(person: CampflowPerson): string {
  const address =
    person.address !== null && typeof person.address === 'object'
      ? (person.address as Record<string, unknown>)
      : {};
  for (const value of [
    address.postcode,
    address.zip,
    address.postal_code,
    address.zip_code,
    person.postcode,
    person.zip,
  ]) {
    const plz = typeof value === 'number' ? String(value) : text(value);
    if (plz) return plz;
  }
  return '';
}

/** The Ort of the person's address in CampFlow, empty if there is none. */
export function city(person: CampflowPerson): string {
  const address =
    person.address !== null && typeof person.address === 'object'
      ? (person.address as Record<string, unknown>)
      : {};
  return text(address.city) || text(address.town);
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
export function kjrPersons(
  persons: CampflowPerson[],
  startDate: string | null
): AbrechnungPerson[] {
  return persons
    .filter(isConfirmed)
    .map((person) => {
      const name = (person.name ?? {}) as { first_name?: unknown; last_name?: unknown };
      return {
        id: person.id,
        ...toKjrPerson({
          lastName: text(name.last_name),
          firstName: text(name.first_name),
          gender: GENDERS[text(person.gender).toLowerCase()] ?? '',
          age: ageAt(person, startDate),
          plz: postalCode(person),
          ort: city(person),
        }),
      };
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
    );
}

/** Counts the confirmed registrations, split at the KJR's age limit on the first day. */
export function countPersons(
  persons: CampflowPerson[],
  startDate: string | null
): KjrPersonenZahlen {
  return countKjrPersons(kjrPersons(persons, startDate));
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
