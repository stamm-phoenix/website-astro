import type { ProtokollTermin } from './protokoll-termin-model';

/** Values of the workflow status; files without one are shown as `Archiv`. */
export const PROTOKOLL_STATUSES = ['Entwurf', 'Review', 'Freigegeben', 'Verschickt'] as const;
export type ProtokollStatus = (typeof PROTOKOLL_STATUSES)[number] | 'Archiv';

/**
 * The mailing of approved minutes. `attempted` is stored before the mail goes out; if it stays,
 * the result is unknown and a resend needs a deliberate confirmation.
 */
export interface ProtokollDelivery {
  state: 'attempted' | 'sent';
  recipients: number;
  at: string;
  by: string;
}

/** Minutes as sent to the Leitendenbereich. */
export interface StaffProtokoll {
  id: string;
  /** Combined SQL workflow version and SharePoint file version. */
  etag: string;
  fileName: string;
  title: string;
  /** Date of the meeting, `YYYY-MM-DD`, or empty if the file name has none. */
  date: string;
  status: ProtokollStatus;
  webUrl: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  /** Why a reviewer sent the minutes back. */
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  /** The file was edited after the approval, so it must be reviewed again before sending. */
  changedSinceApproval: boolean;
  delivery: ProtokollDelivery | null;
  /** The next meeting: suggestion read from the approved file and the reviewer's decision. */
  termin: ProtokollTermin | null;
  /** The suggestion belongs to another version than the approved one, or the file changed. */
  terminStale: boolean;
}
