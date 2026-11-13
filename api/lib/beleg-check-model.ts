/** Result of the check as stored with the receipt and sent to the browser. */
export interface BelegCheck {
  /** Receipt, complete, readable and, for an Eigenbeleg, signed: fit for the archive. */
  ok: boolean;
  isReceipt: boolean;
  complete: boolean;
  readable: boolean;
  /**
   * An Eigenbeleg (written by the person who paid) without that person's signature; the Kasse
   * rejects it (discussion #460).
   */
  unsignedEigenbeleg: boolean;
  /** Concrete problems in German, e.g. „Der Gesamtbetrag ist abgeschnitten.“ */
  issues: string[];
  /**
   * Positions that are not suitable for youth work (alcohol, tobacco, other adult-only items),
   * as printed on the receipt. A hint for the Kasse; it does not affect `ok`.
   */
  restrictedItems: string[];
  shop: string | null;
  /** `YYYY-MM-DD` */
  date: string | null;
  amountCent: number | null;
  checkedAt: string;
}
