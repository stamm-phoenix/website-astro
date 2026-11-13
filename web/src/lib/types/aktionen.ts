/** CampFlow events, Aktionen of the Leitendenbereich and Beiträge. */
import type { CampflowColumn, CampflowPerson } from '../../../../api/lib/campflow';
import type { StaffAktion } from '../../../../api/lib/aktionen-list';
import type { AktionBeitrag, Beitrag, BeitragSammlung } from '../../../../api/lib/beitraege';

/** A CampFlow event (Aktion) as seen in the Leitendenbereich. */
export interface CampflowEvent {
  id: string;
  title: string;
  /** Whether the registration form accepts registrations. */
  published: boolean;
  start_date: string | null;
  end_date: string | null;
  max_persons: number | null;
  archived: boolean;
  /** Link to the registration form. */
  url: string | null;
  collection: { id: string; name: string } | null;
  /**
   * Whether the KJR grant is applied for (default). Without it the Aktion has no KJR deadline
   * and its Abrechnung shows income and expenses only.
   */
  zuschussfaehig: boolean;
  /**
   * Whether the event is no real Aktion, e.g. an order of jumpers that only uses the
   * registration and payment of CampFlow. Such events are left out of the public calendar and
   * of every choice of Aktionen, and never get the KJR grant (`lib/aktionArt.ts`).
   */
  keineAktion: boolean;
}

/** The CampFlow member list, read-only (`/api/intern/mitglieder`, without payment details). */
export interface MitgliederData {
  loadedAt: string;
  columns: CampflowColumn[];
  persons: CampflowPerson[];
}

export interface CampflowEventDetail {
  event: CampflowEvent;
  columns: CampflowColumn[];
  persons: CampflowPerson[];
  /**
   * IDs of the own registrations, matched on the server by address (`docs/personen.md`); `null`
   * when it could not compare, then the names decide.
   */
  ich?: string[] | null;
}

/**
 * What the Aktionen dialog edits: a CampFlow event (`event`) with or without its calendar entry
 * (`entry`), or a calendar entry without CampFlow event; both `null` creates a free entry.
 */
export interface AktionTarget {
  event: CampflowEvent | null;
  entry: StaffAktion | null;
}

/** Something shown in the month grid (`MonthGrid.svelte`). */
export interface CalendarItem {
  key: string;
  title: string;
  /** `YYYY-MM-DD` */
  start: string | null;
  end: string | null;
}

/** A CampFlow event with its calendar entry, or a calendar entry without CampFlow event. */
export interface AktionRow extends CalendarItem {
  event: CampflowEvent | null;
  entry: StaffAktion | null;
}

export interface StaffAktionenData {
  stufen: string[];
  items: StaffAktion[];
}

/** The Beiträge of every participant of an Aktion, by CampFlow person ID. */
export interface AktionBeitraegeData {
  /** The CampFlow event (`evt_…`) these Beiträge belong to. */
  eventId: string;
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  /** A person without Beitrag has an empty list; one missing here was not in CampFlow yet. */
  persons: Record<string, AktionBeitrag[]>;
}

/** A read-only copy of CampFlow's page „Beiträge“. */
export interface BeitraegeData {
  /** When the Beiträge were read from CampFlow (ISO 8601). */
  loadedAt: string;
  batches: BeitragSammlung[];
  fees: Beitrag[];
}

/**
 * The Beiträge with something left to do (open or paid too much), for „Meine Beiträge“ on the
 * start page (`GET /api/intern/beitraege/meine`).
 */
export interface OffeneBeitraegeData extends BeitraegeData {
  /**
   * Per Beitrag ID whether it is the logged-in person's own, as far as the server could check it
   * (`docs/personen.md`); a missing Beitrag, or `null` without a link, is decided by the payer.
   */
  ich: Record<string, boolean> | null;
}
