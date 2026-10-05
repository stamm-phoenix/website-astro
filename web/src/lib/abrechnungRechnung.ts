// Calculations of the Abrechnung that depend on what is entered on the page: the
// Materialleihgebühren as a virtual expense and the target of the Abrechnung.
import type { Abrechnung, KategorieSumme, LeihgebuehrenTarif, Nachweis } from './types';

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
  virtual?: boolean;
}

/** The Einzelnachweise with the Materialleihgebühren as a virtual entry on top. */
export function nachweiseMitLeihgebuehren(
  nachweise: Nachweis[],
  leihgebuehrenCent: number,
  today: string
): NachweisZeile[] {
  if (leihgebuehrenCent <= 0) return nachweise;
  return [
    {
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
