import type { CampflowEvent, CampflowPerson } from './campflow';
import { KJR_BETREUER_AGE } from './kjr-zuschuss';

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

/** Counts the confirmed registrations, split at the KJR's age limit on the first day. */
export function countPersons(persons: CampflowPerson[], startDate: string | null): PersonenZahlen {
  const counts: PersonenZahlen = { total: 0, under27: 0, from27: 0, unknownAge: 0 };
  for (const person of persons) {
    if (isFilled(person.cancellation_date) || !isFilled(person.confirmation_date)) continue;
    counts.total++;
    const age = ageAt(person, startDate);
    if (age === null) counts.unknownAge++;
    else if (age >= KJR_BETREUER_AGE) counts.from27++;
    else counts.under27++;
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
