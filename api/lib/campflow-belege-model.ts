/**
 * Where a receipt stands in CampFlow: `unbooked` uploaded but not booked yet („Ungeprüfte
 * Belege“), `open` booked but not fully matched to a payment (an Auslage is not paid back yet),
 * `settled` booked and matched in full (paid, or paid back).
 */
export type CampflowBelegStatus = 'unbooked' | 'open' | 'settled';

/** A receipt as CampFlow's page „Belege“ lists it. */
export interface CampflowBeleg {
  /** The booking (`exp_…`), or for an unbooked receipt the receipt (`rcp_…`). */
  id: string;
  /** Belegnummer like `2026-94`, null until the receipt is booked. */
  number: string | null;
  status: CampflowBelegStatus;
  description: string;
  /** Belegdatum `YYYY-MM-DD`, null for an unbooked receipt. */
  date: string | null;
  /** Negative for expenses, positive for income, in euro cents. */
  amountCent: number;
  /** Part not yet matched to a payment, with the amount's sign. */
  openCent: number;
  /** „Auslage durch“: who paid out of pocket, null if nobody did. */
  paidBy: string | null;
  costUnits: { id: string; name: string }[];
  categories: { id: string; name: string; costUnitId: string | null }[];
  pages: number;
  /** File name in CampFlow, only for unbooked receipts, which have nothing else to tell them apart. */
  fileName: string | null;
  /** Upload time as CampFlow reports it, `YYYY-MM-DD HH:MM:SS`. */
  uploadedAt: string | null;
  /** When a `settled` receipt was paid or paid back, `YYYY-MM-DD`; null otherwise or if unknown. */
  settledAt: string | null;
  /** Transferred from the Belege module of this website. */
  viaWebsite: boolean;
  /** Transferred from the Belege module and submitted there by the user asking. */
  submittedByMe: boolean;
  /** „Auslage durch“ names the user asking. */
  mine: boolean;
}
