import type { ColumnType, Generated } from 'kysely';
import type { ReadOnly } from './db-schema-types';
import type { BelegCampflowState } from './beleg-model';

export interface BelegTable {
  /** Taken over from SharePoint or assigned by `nextContentId`. */
  id: number;
  version: ReadOnly<Buffer>;
  shop: string;
  beleg_date: ColumnType<Date | string | null, string | null, string | null>;
  amount_cent: number;
  paid_by: string;
  payout: boolean;
  /** Older receipts only; newer ones name Kostenstelle and Kategorie. */
  aktion: Generated<string>;
  /** Name of the Kostenstelle in CampFlow, or a new one typed in. */
  kostenstelle: Generated<string>;
  /** Name of the Kategorie of that Kostenstelle, or a new one typed in. */
  kategorie: Generated<string>;
  note: string;
  status: 'Eingereicht' | 'Angenommen' | 'Abgelehnt';
  review_note: string;
  submitted_by: string;
  /** Written as ISO text, so `datetime2(3)` keeps the milliseconds. */
  submitted_at: ColumnType<Date, string, string>;
  /**
   * `beleg-<digits>.jpg`, `beleg-<digits>-scan.jpg` or a PDF `beleg-<digits>.pdf`, or null without
   * a photo.
   */
  photo: ColumnType<string | null, string | null | undefined, string | null>;
  /** An expense or income; income has no Auslage. */
  art: Generated<BelegArt>;
  /** `BelegCheck` as JSON. */
  ai_check: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: Generated<string>;
}

export type BelegArt = 'Ausgabe' | 'Einnahme';

export type { BelegCampflowState };

/** Transfer of a receipt to CampFlow; outlives the receipt, so it has no foreign key. */
export interface BelegCampflowTable {
  beleg_id: number;
  version: ReadOnly<Buffer>;
  state: BelegCampflowState;
  /** File name in CampFlow, the key against duplicates; the same for every attempt. */
  file_name: string;
  costunit_id: string;
  costunit_name: string;
  category_id: string;
  category_name: string;
  shop: string;
  beleg_date: ColumnType<Date | string | null, string | null, string | null>;
  amount_cent: number;
  art: Generated<BelegArt>;
  paid_by: Generated<string>;
  payout: Generated<boolean>;
  aktion: Generated<string>;
  note: Generated<string>;
  submitted_by: Generated<string>;
  /** `rowversion` of the receipt whose details were sent; the snapshot above. */
  beleg_version: Buffer;
  error: Generated<string>;
  campflow_number: ColumnType<string | null, string | null | undefined, string | null>;
  campflow_receipt_id: ColumnType<string | null, string | null | undefined, string | null>;
  campflow_expense_id: ColumnType<string | null, string | null | undefined, string | null>;
  started_by: string;
  /** Written as ISO text, so `datetime2(3)` keeps the milliseconds. */
  started_at: ColumnType<Date, string, string>;
  uploaded_at: ColumnType<Date | null, string | null | undefined, string | null>;
  beleg_deleted_at: ColumnType<Date | null, string | null | undefined, string | null>;
}
