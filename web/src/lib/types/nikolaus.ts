/** Nikolausdienst: booking, visit progress and the staff view of bookings. */
import type { NikolausBookingDetails, NikolausSettings } from '../nikolausConfig';
import type { NikolausDayContact } from '../../../../api/lib/nikolaus-config';

export interface NikolausSlot {
  /** Local slot key, e.g. `2026-12-05T17:00`. */
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  available: number;
  /** The online booking for this day is closed (from midnight of the day on). */
  closed: boolean;
}

export interface NikolausBookingRequest extends NikolausBookingDetails {
  slot: string;
  /** Honeypot, must stay empty. */
  website: string;
  /** Solved ALTCHA challenge (base64 payload of the widget). */
  altcha: string;
}

export interface NikolausBookingCreated {
  status: 'pending';
  reservedUntil?: string;
}

export interface NikolausBookingInfo extends NikolausBookingDetails {
  etag: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  /** Stored location of the address, if it could be found. */
  location: NikolausLocation | null;
  slot: { key: string; date: string; time: string; endTime: string } | null;
  reservedUntil: string | null;
  /** Latest point in time for online changes and cancellations (ISO). */
  changeDeadline: string | null;
  changeDeadlineHours: number;
  /** Whether details, slot and cancellation can currently be changed online. */
  canChange: boolean;
}

/** No progress to show: not confirmed, not the visit day, or not planned yet. */
export interface NikolausVisitProgressWaiting {
  phase: 'none' | 'before' | 'over' | 'planning';
  /** Contact for emergencies; only with `planning`, from two hours before the slot. */
  contact?: NikolausDayContact | null;
}

/** Progress of the team's route on the visit day, seen from the family. */
export interface NikolausVisitProgressToday {
  phase: 'today';
  /** Position of the family in the team's route, starting at 1. */
  position: number;
  /** Visits still to come before the family's. */
  stopsAhead: number;
  /** Whether the team has checked off any visit yet. */
  started: boolean;
  plannedArrival: string;
  /** Expected arrival `HH:MM`, corrected by the team's delay; `null` if it is overdue. */
  eta: string | null;
  delayMinutes: number;
  visited: boolean;
  contact: NikolausDayContact | null;
}

/** How far the Nikolaus still is from the family. */
export type NikolausVisitProgress = NikolausVisitProgressWaiting | NikolausVisitProgressToday;

export interface NikolausLinkRequested {
  status: 'sent';
  /** Minimum minutes between two link mails for the same booking. */
  cooldownMinutes: number;
}

/** Answer of `POST /api/kontakt`. */
export interface KontaktSent {
  status: 'sent';
  /** Whether the receipt to the visitor went out; the message itself has arrived either way. */
  receipt: boolean;
}

export interface NikolausLocation {
  lat: number;
  lon: number;
  /** Only the town could be located, not the exact address. */
  approximate: boolean;
}

export interface NikolausGeocodeResult {
  found: boolean;
  precision?: 'address' | 'street' | 'area';
  lat?: number;
  lon?: number;
  /** The map service could not be reached; nothing is known then. */
  unavailable?: boolean;
}

/** Raw form values of the booking details, as entered by the family. */
export interface NikolausDetailsForm {
  familyName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  addressNotes: string;
  /** Number input; `null` while empty. */
  childrenCount: number | null;
  withKrampus: 'ja' | 'nein' | null;
  hidingPlace: string;
  notes: string;
}

export type NikolausBookingStatus = NikolausBookingInfo['status'];

/** A Nikolaus booking as seen in the Leitendenbereich. */
export interface StaffNikolausBooking extends NikolausBookingDetails {
  etag: string;
  id: string;
  /** Local slot key, e.g. `2026-12-05T17:00`; may point to a slot no longer configured. */
  slotKey: string;
  status: NikolausBookingStatus;
  location: NikolausLocation | null;
  reservedUntil: string | null;
  confirmedAt: string | null;
  changedAt: string | null;
  /** Tags for the internal planning; never shown to the family. */
  internalTags: string[];
}

export interface StaffNikolausSlot {
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  /** Places currently occupied (confirmed or pending within the hold time). */
  taken: number;
}

/** Personal data of the Nikolausdienst and when it must be deleted (`/api/intern/nikolaus/steuerung`). */
export interface NikolausCleanupStatus {
  bookings: number;
  dispoVisits: number;
  helpers: number;
  assignments: number;
  lastVisit: string | null;
  deleteBy: string | null;
  due: boolean;
}

export type NikolausCleanupScope = 'bookings' | 'helpers';

export interface NikolausAuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

/** Everything the module „Steuerung“ shows. */
export interface StaffNikolausSteuerung {
  settings: NikolausSettings;
  etag: string;
  updatedAt: string;
  updatedBy: string;
  cleanup: NikolausCleanupStatus;
  /** What has to be typed to confirm a deletion. */
  confirmations: Record<NikolausCleanupScope, string>;
  log: NikolausAuditEntry[];
}
