// Calculations of the Abrechnung that depend on what is entered on the page: the
// Materialleihgebühren as a virtual expense and the target of the Abrechnung.
import type { Abrechnung, KategorieSumme, Nachweis } from './types';

/** Fees of the Stamm's tents and material per day, set by the e.V.-Versammlung on 02.04.2023. */
export const LEIHGEBUEHREN = [
  { id: 'jurte', name: 'Jurte', priceCent: 2500 },
  { id: 'ovaljurte', name: 'Ovaljurte', priceCent: 3500 },
  { id: 'tuareg', name: 'Tuareg', priceCent: 2000 },
  { id: 'kohte', name: 'Kohte', priceCent: 1500 },
  { id: 'kueche', name: 'Küchenmaterial', priceCent: 2000 },
  { id: 'erste-hilfe', name: 'Erste-Hilfe-Material', priceCent: 1000 },
  { id: 'basteln', name: 'Bastelmaterial', priceCent: 1000 },
  { id: 'brettspiele', name: 'Brettspielekiste', priceCent: 1000 },
  { id: 'werkzeug', name: 'Werkzeugkiste', priceCent: 1000 },
  { id: 'moderation', name: 'Moderationskoffer', priceCent: 1000 },
  { id: 'outdoor-spiele', name: 'Outdoor-Spielekiste', priceCent: 1000 },
  { id: 'zeltlampe', name: 'Zeltlampe', priceCent: 500 },
] as const;

export const LEIHGEBUEHREN_BESCHLUSS = 'e.V.-Versammlung am 02.04.2023';
/** CampFlow category for the fees: the KJR wants them as Unterkunft, not Material. */
export const LEIHGEBUEHREN_KATEGORIE = 'Unterkunft';
/** The Abrechnung is fine when the final result is within this range around 0 €. */
export const ZIEL_TOLERANZ_CENT = 10_000;

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

export function leihgebuehren(
  eingabe: Record<string, LeihgebuehrEingabe>,
  defaultDays: number
): Leihgebuehren {
  const positions = LEIHGEBUEHREN.map((item) => {
    const count = Math.max(0, eingabe[item.id]?.count ?? 0);
    const days = Math.max(0, eingabe[item.id]?.days ?? defaultDays);
    return { ...item, count, days, cent: count * days * item.priceCent };
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
