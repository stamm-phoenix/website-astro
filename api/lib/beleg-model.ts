import type { BelegCheck } from './beleg-check-model';

/**
 * Review states of a receipt. The real bookkeeping happens in CampFlow; here the Kasse only
 * accepts a receipt (then transfers it to CampFlow) or rejects it with a reason.
 */
export const BELEG_STATUSES = ['Eingereicht', 'Angenommen', 'Abgelehnt'] as const;
export type BelegStatus = (typeof BELEG_STATUSES)[number];

/** An expense, or income such as a donation or a fee paid in cash; income has no Auslage. */
export const BELEG_ARTEN = ['Ausgabe', 'Einnahme'] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number];

/** Where the transfer of a receipt to CampFlow stands. */
export type BelegCampflowState = 'Gestartet' | 'Fehlgeschlagen' | 'Hochgeladen';

/**
 * The Belege in Azure SQL (`organisation.beleg`, migration `0026_aktionen_belege_instagram.sql`)
 * with their photos in Blob Storage (`beleg-photos.ts`).
 */

/** A receipt as sent to the Leitendenbereich. */
export interface StaffBeleg {
  id: string;
  etag: string;
  /** An expense or income; income has no Auslage. */
  art: BelegArt;
  shop: string;
  date: string;
  amountCent: number;
  paidBy: string;
  payout: boolean;
  /** Older receipts only; newer ones name Kostenstelle and Kategorie. */
  aktion: string;
  /** Name of the Kostenstelle in CampFlow; may not exist there yet. */
  kostenstelle: string;
  /** Name of the Kategorie; may not exist in the Kostenstelle yet. */
  kategorie: string;
  note: string;
  status: BelegStatus;
  reviewNote: string;
  submittedBy: string;
  submittedAt: string;
  hasImage: boolean;
  /** Whether the unedited photo is stored next to the scan. */
  hasOriginal: boolean;
  /** Whether the receipt is a PDF; the photo endpoint then shows its first page. */
  isPdf: boolean;
  /** Preliminary check of the photo by the image model, if configured. */
  aiCheck: BelegCheck | null;
  /** The last transfer to CampFlow (`beleg-campflow.ts`), null if there was none. */
  campflow: BelegCampflow | null;
  /** Someone else submitted the user's Auslage: they may look at it, not change it. */
  readOnly?: true;
  /** An Auslage of the user asking, by the names the server knows for them. */
  mine?: true;
  /** Name of who submitted it, when the directory knows their login. */
  submittedByName?: string;
  /** Whether the user asking may still change its details and photo (`beleg-rechte.ts`). */
  editable?: boolean;
}

/** Transfer of a receipt to CampFlow, as the Kasse sees it. */
export interface BelegCampflow {
  state: BelegCampflowState;
  costUnitId: string;
  costUnitName: string;
  categoryId: string;
  categoryName: string;
  /** Belegnummer in CampFlow once uploaded, e.g. `2026-112`. */
  number: string | null;
  /** What went wrong in the last attempt; empty after success. */
  error: string;
  startedBy: string;
  startedAt: string;
}
