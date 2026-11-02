/**
 * The receipts of a Planung (`docs/essensplanung.md`, Belege): who paid what, and whether it was
 * paid back. Without zod, so the page uses it too; the checks of the requests are in
 * `essen-belege-validation.ts`.
 */

/** Receipts per Planung. */
export const MAX_BELEGE = 500;
/** 10.000 € – anything above is surely a typo. */
export const MAX_BELEG_BETRAG_CENT = 1_000_000;
export const MAX_BELEG_HAENDLER = 100;
export const MAX_BELEG_NOTIZ = 500;
export const MAX_BELEG_NAME = 100;

/** A receipt as the page shows it. */
export interface PlanungBeleg {
  id: number;
  etag: string;
  /** `YYYY-MM-DD`. */
  datum: string;
  betragCent: number;
  /** Shop or what was bought; may be empty. */
  haendler: string;
  notiz: string;
  /** The member who paid, or null for someone else (`bezahltVonText`). */
  bezahltVonId: number | null;
  bezahltVonText: string;
  /** Who paid as shown: the member's current name or the free one. */
  bezahltVon: string;
  erstattet: boolean;
  /** When it was marked as paid back (ISO), and by whom; null while it is not. */
  erstattetAm: string | null;
  erstattetVon: string;
  /** Kind of the stored file: a photo, a PDF (shown by its first page), or none. */
  foto: 'bild' | 'pdf' | null;
  /** Whether the unedited photo is kept next to a scan. */
  original: boolean;
  angelegtVon: string;
  angelegtAm: string;
}

/** Who paid: a member of the Planung or someone else by name, exactly one of both. */
export interface BelegBezahltVon {
  bezahltVonId: number | null;
  bezahltVonText: string;
}

/** A new receipt; the photo travels beside it. */
export interface BelegInput extends BelegBezahltVon {
  datum: string;
  betragCent: number;
  haendler: string;
  notiz: string;
  erstattet: boolean;
}

/** The fields of a receipt someone changed; at least one. */
export interface BelegAenderung {
  datum?: string;
  betragCent?: number;
  haendler?: string;
  notiz?: string;
  bezahltVon?: BelegBezahltVon;
  erstattet?: boolean;
}

/** Which picture of a receipt is asked for (`GET planung/belege/{id}/foto?art=`). */
export const BELEG_FOTO_ARTEN = ['vorschau', 'bild', 'original', 'datei'] as const;
export type BelegFotoArt = (typeof BELEG_FOTO_ARTEN)[number];
