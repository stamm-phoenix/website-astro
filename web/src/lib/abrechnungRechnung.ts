// Calculations of the Abrechnung that depend on what is entered on the page: the
// Materialleihgebühren as a virtual expense and the target of the Abrechnung.
import type {
  Abrechnung,
  AbrechnungPerson,
  KategorieSumme,
  LeihgebuehrenTarif,
  Nachweis,
} from './types';

/** CampFlow category for the fees: the KJR wants them as Unterkunft, not Material. */
export const LEIHGEBUEHREN_KATEGORIE = 'Unterkunft';
/** The Abrechnung is fine when the final result is within this range around 0 €. */
export const ZIEL_TOLERANZ_CENT = 10_000;

/** The decision behind the fees, e.g. „e.V.-Versammlung am 02.04.2023“. */
export function leihgebuehrenBeschluss(tarif: LeihgebuehrenTarif): string {
  const [year, month, day] = tarif.stand.split('-');
  return `${tarif.beschlossenVon} am ${day}.${month}.${year}`;
}

export interface LeihgebuehrEingabe {
  count: number;
  /** `null`: the days of the KJR grant (overnight stays plus Zusatztag). */
  days: number | null;
}

export interface LeihgebuehrPosition {
  id: string;
  name: string;
  priceCent: number;
  count: number;
  days: number;
  cent: number;
}

export interface Leihgebuehren {
  positions: LeihgebuehrPosition[];
  totalCent: number;
}

/** The fees for what is entered on the page, with the prices of the API's config. */
export function leihgebuehren(
  tarif: LeihgebuehrenTarif,
  eingabe: Record<string, LeihgebuehrEingabe>,
  defaultDays: number
): Leihgebuehren {
  const positions = tarif.material.map((item) => {
    const count = Math.max(0, eingabe[item.id]?.count ?? 0);
    const days = Math.max(0, eingabe[item.id]?.days ?? defaultDays);
    const priceCent = item.priceCentPerDay;
    return { id: item.id, name: item.name, priceCent, count, days, cent: count * days * priceCent };
  });
  return { positions, totalCent: positions.reduce((sum, p) => sum + p.cent, 0) };
}

export interface BilanzZeile extends KategorieSumme {
  /** The Materialleihgebühren entered on the page, not booked in CampFlow yet. */
  virtual?: boolean;
}

export interface BilanzMitLeihgebuehren {
  incomeCent: number;
  expenseCent: number;
  resultCent: number;
  income: BilanzZeile[];
  expenses: BilanzZeile[];
}

/** The balance with the Materialleihgebühren as an additional (virtual) expense. */
export function bilanzMitLeihgebuehren(
  bilanz: Abrechnung['bilanz'],
  leihgebuehrenCent: number
): BilanzMitLeihgebuehren {
  if (leihgebuehrenCent <= 0) return { ...bilanz };
  const virtual: BilanzZeile = {
    category: `${LEIHGEBUEHREN_KATEGORIE} (Materialleihgebühren, virtuell)`,
    cent: leihgebuehrenCent,
    count: 1,
    virtual: true,
  };
  return {
    incomeCent: bilanz.incomeCent,
    expenseCent: bilanz.expenseCent + leihgebuehrenCent,
    resultCent: bilanz.resultCent - leihgebuehrenCent,
    income: bilanz.income,
    expenses: [...bilanz.expenses, virtual].sort((a, b) => b.cent - a.cent),
  };
}

export interface NachweisZeile extends Nachweis {
  /** Identifies the entry across „Neu laden“, for the amounts changed on the page. */
  key: string;
  virtual?: boolean;
  /** CampFlow's amount when the amount was changed on the page (`cent` is the changed one). */
  originalCent?: number;
}

/**
 * Keys of the Einzelnachweise from their content, as CampFlow's export has no IDs. Identical
 * entries are told apart by their order, so the keys stay the same after exporting again. The
 * amount is left out, so a changed amount is kept when the amount in CampFlow is corrected.
 */
export function nachweisKeys(nachweise: Nachweis[]): string[] {
  const seen = new Map<string, number>();
  return nachweise.map((n) => {
    const base = JSON.stringify([
      n.receiptNumber,
      n.date,
      n.category,
      n.type,
      n.description,
      n.paidBy,
    ]);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

/** The Einzelnachweise with the amounts changed on the page (in cent, by `key`). */
export function nachweiseMitBetraegen(
  nachweise: Nachweis[],
  betraege: Record<string, number>
): NachweisZeile[] {
  const keys = nachweisKeys(nachweise);
  return nachweise.map((nachweis, index) => {
    const key = keys[index];
    const cent = betraege[key];
    return cent === undefined || cent === nachweis.cent
      ? { ...nachweis, key }
      : { ...nachweis, key, cent, originalCent: nachweis.cent };
  });
}

/** How many of the Einzelnachweise have an amount changed on the page. */
export function geaenderteBetraege(nachweise: NachweisZeile[]): number {
  return nachweise.filter((n) => n.originalCent !== undefined).length;
}

function sumByCategory(rows: { category: string; cent: number }[]): KategorieSumme[] {
  const sums = new Map<string, KategorieSumme>();
  for (const { category, cent } of rows) {
    const sum = sums.get(category) ?? { category, cent: 0, count: 0 };
    sum.cent += cent;
    sum.count++;
    sums.set(category, sum);
  }
  return [...sums.values()].sort(
    (a, b) => b.cent - a.cent || a.category.localeCompare(b.category, 'de')
  );
}

/**
 * The balance with the amounts changed on the page, summed per category like the API does
 * (`summarizeEntries` in `api/lib/abrechnung.ts`). Without changes it is the API's balance.
 */
export function bilanzMitBetraegen(
  bilanz: Abrechnung['bilanz'],
  nachweise: NachweisZeile[]
): Abrechnung['bilanz'] {
  if (geaenderteBetraege(nachweise) === 0) return bilanz;
  const income = sumByCategory(nachweise.filter((n) => n.cent > 0));
  const expenses = sumByCategory(
    nachweise.filter((n) => n.cent < 0).map((n) => ({ category: n.category, cent: -n.cent }))
  );
  const incomeCent = income.reduce((sum, row) => sum + row.cent, 0);
  const expenseCent = expenses.reduce((sum, row) => sum + row.cent, 0);
  return {
    incomeCent,
    expenseCent,
    resultCent: incomeCent - expenseCent,
    income,
    expenses,
    entryCount: bilanz.entryCount,
  };
}

/** The Einzelnachweise with the Materialleihgebühren as a virtual entry on top. */
export function nachweiseMitLeihgebuehren(
  nachweise: NachweisZeile[],
  leihgebuehrenCent: number,
  today: string
): NachweisZeile[] {
  if (leihgebuehrenCent <= 0) return nachweise;
  return [
    {
      key: 'leihgebuehren',
      receiptNumber: null,
      type: 'Materialleihgebühr (virtuell)',
      description: 'Leihgebühren für Zelte und Material, noch nicht in CampFlow gebucht',
      category: LEIHGEBUEHREN_KATEGORIE,
      paidBy: 'Sparbuch',
      date: today,
      cent: -leihgebuehrenCent,
      virtual: true,
    },
    ...nachweise,
  ];
}

export interface Auslage {
  /** „Auslage durch“ in CampFlow. */
  name: string;
  /** Positive sum of the expenses paid by this person. */
  cent: number;
  count: number;
}

/**
 * Expenses per person who paid them („Übersicht Auslagen“ in the Mappe), largest first.
 * Expenses without „Auslage durch“ were paid by the Stamm directly.
 */
export function auslagen(nachweise: Nachweis[]): Auslage[] {
  const byName = new Map<string, Auslage>();
  for (const nachweis of nachweise) {
    const name = nachweis.paidBy?.trim();
    if (!name || nachweis.cent >= 0) continue;
    const entry = byName.get(name) ?? { name, cent: 0, count: 0 };
    entry.cent -= nachweis.cent;
    entry.count++;
    byName.set(name, entry);
  }
  return [...byName.values()].sort((a, b) => b.cent - a.cent || a.name.localeCompare(b.name));
}

/** Whether the KJR subsidises a person, and why, e.g. „ja (LK Rosenheim)“. */
export function zuschussGrund(person: AbrechnungPerson): { subsidised: boolean; label: string } {
  if (person.betreuer) return { subsidised: true, label: 'ja (Betreuer*in)' };
  switch (person.herkunft) {
    case 'landkreis':
      return { subsidised: true, label: 'ja (LK Rosenheim)' };
    case 'stadt':
      return { subsidised: false, label: 'nein (Stadt Rosenheim)' };
    case 'andere':
      return { subsidised: false, label: 'nein (nicht LK Rosenheim)' };
    default:
      return { subsidised: false, label: 'nein (PLZ fehlt)' };
  }
}
