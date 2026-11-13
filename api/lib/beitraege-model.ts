/** Where a Beitrag stands, as CampFlow shows it (see the Playwright API's README). */
export type BeitragStatus = 'paid' | 'unpaid' | 'partial' | 'refund' | 'cancelled';

/** A Sammlung of CampFlow's Beiträge: the fees of an event, a Mitgliedsbeitrag or others. */
export interface BeitragSammlung {
  id: string;
  name: string;
  /** `event`, `annuity` (Mitgliedsbeitrag) or `manual`. */
  type: string;
  /** The CampFlow event (`evt_…`) of a Sammlung of type `event`, else null. */
  eventId: string | null;
  feeCount: number;
  /** Paid in full or cancelled. */
  settledCount: number;
  totalCent: number;
  /** Still to be paid. */
  openCent: number;
  /** Paid too much, to be paid back. */
  refundCent: number;
}

/** One fee: who has to pay how much for what, and what was paid. */
export interface Beitrag {
  id: string;
  /** Verwendungszweck of the transfer. */
  reference: string;
  description: string;
  batchId: string | null;
  costUnit: { id: string; name: string } | null;
  category: string | null;
  payer: string;
  /**
   * CampFlow's ID of the payer: a person of the member list, or for a fee of an event the
   * registration (`per_…`, see `docs/personen.md`); null if unknown.
   */
  payerId: string | null;
  /** CampFlow's name of the payment method, e.g. `bank_transfer`; null if unknown. */
  paymentMethod: string | null;
  /** Day the fee was created, `YYYY-MM-DD`. */
  date: string;
  /** As CampFlow's list shows it; for a cancelled fee the amount cancelled. */
  amountCent: number;
  dueCent: number;
  paidCent: number;
  /** Negative when paid too much. */
  openCent: number;
  status: BeitragStatus;
  /** Day of the latest payment, `YYYY-MM-DD`; null if none. */
  paidAt: string | null;
}

/** Leitendenbereich → Beiträge: a read-only copy of CampFlow's page „Beiträge“. */
export interface Beitraege {
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  batches: BeitragSammlung[];
  fees: Beitrag[];
}

/**
 * A Beitrag of a participant, as CampFlow's page of the Aktion shows it next to the person. It
 * comes without payer and payment date, which that list does not have.
 */
export interface AktionBeitrag {
  id: string;
  /** Verwendungszweck of the transfer. */
  reference: string;
  description: string;
  /** As CampFlow's list shows it; for a cancelled fee the amount cancelled. */
  amountCent: number;
  dueCent: number;
  paidCent: number;
  /** Negative when paid too much. */
  openCent: number;
  status: BeitragStatus;
}

/** Leitendenbereich → Aktionen → Teilnehmende: the Beiträge of every person of an Aktion. */
export interface AktionBeitraege {
  /** The CampFlow event (`evt_…`) the Beiträge belong to. */
  eventId: string;
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  /** Beiträge per CampFlow person ID (`per_…`); a person without Beitrag has an empty list. */
  persons: Record<string, AktionBeitrag[]>;
}
