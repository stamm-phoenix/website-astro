/** Types of the Kostenstellen that the browser shares with the API. No imports. */

/** Gemeinnützige Sphäre of a Kategorie, as CampFlow names them. */
export const CAMPFLOW_SPHERES = ['ideal', 'purpose', 'assets', 'business'] as const;

export type KostenstellenSphaere = (typeof CAMPFLOW_SPHERES)[number];

/** Sums of a Kostenstelle or Kategorie in euro cents; expenses are negative. */
export interface KostenstellenSummen {
  incomeCent: number;
  expensesCent: number;
  balanceCent: number;
  /** Income not yet matched to a payment, e.g. unpaid Beiträge. */
  openIncomeCent: number;
  /** Expenses not yet matched to a payment, e.g. Auslagen not paid back yet; negative. */
  openExpensesCent: number;
  /** Receipts, Beiträge and other bookings. */
  bookings: number;
}

export interface JahresSummen extends KostenstellenSummen {
  year: number;
}

export interface KategorieStatistik extends KostenstellenSummen {
  /** null for a Kategorie with bookings that the Kostenstelle no longer lists. */
  id: string | null;
  /** "" for bookings without a Kategorie. */
  name: string;
  sphere: KostenstellenSphaere | null;
  /** The sums of each year with bookings in this Kategorie. */
  yearTotals: JahresSummen[];
}

export interface KostenstelleStatistik extends KostenstellenSummen {
  /** null for a Kostenstelle with bookings that CampFlow no longer lists. */
  id: string | null;
  name: string;
  /** Hex colour from CampFlow, null if unknown. */
  color: string | null;
  archived: boolean;
  /** Calendar years with at least one booking, ascending. */
  years: number[];
  /** The sums of each of these years. */
  yearTotals: JahresSummen[];
  categories: KategorieStatistik[];
}

export interface Kostenstelle {
  id: string;
  name: string;
  archived: boolean;
  /** The Kategorien of the Kostenstelle, to book a receipt on one of them. */
  categories: { id: string; name: string }[];
}
