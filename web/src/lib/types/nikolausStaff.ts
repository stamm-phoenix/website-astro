/** Nikolausdienst in the Leitendenbereich: Dispo, Fahrt, helpers and Einteilung. */
import type { EinteilungDay, HelperRole as NikolausHelperRole } from '../nikolausEinteilung';
import type { NikolausLocation, StaffNikolausBooking, StaffNikolausSlot } from './nikolaus';

/** Status of the Nikolausdienst for every page of the Leitendenbereich. */
export interface StaffNikolausStatus {
  staffActive: boolean;
  maintenance: boolean;
  deleteBy: string | null;
  deletionDue: boolean;
}

export interface StaffNikolausOverview {
  slots: StaffNikolausSlot[];
  bookings: StaffNikolausBooking[];
}

/** A booking to be moved by staff, optionally with a preselected target slot. */
export interface NikolausMoveRequest {
  booking: StaffNikolausBooking;
  /** Target slot key, e.g. from drag and drop in the matrix. */
  target?: string;
}

export interface NikolausMoveResult {
  booking: StaffNikolausBooking;
  target: string;
  /** Whether the notification mail to the family could be sent. */
  mailSent: boolean;
}

/** A saved row of the Nikolaus-Dispo (one per planned booking). */
export interface StaffNikolausDispoRow {
  bookingId: string;
  team: string;
  order: number;
  /** Slot of the booking when the Dispo was saved. */
  slotKey: string;
  plannedArrival: string;
  fixed: boolean;
  visited: boolean;
  visitedAt: string;
  /** Exact time of the check-off (ISO), only when the Dispo is loaded. */
  checkedOffAt?: string;
  /** Family of the booking, also when it left the day; only when the Dispo is loaded. */
  familyName?: string | null;
}

/** Everything the Dispo page needs for one day. */
export interface StaffNikolausDispoData {
  date: string;
  teams: { name: string; color: string }[];
  minutesPerChild: number;
  minVisitMinutes: number;
  maxVisitMinutes: number;
  /** Confirmed bookings of the day, in chronological order. */
  stops: StaffNikolausBooking[];
  /** Driving minutes; index 0 is the base, index `i + 1` is `stops[i]`. */
  travel: number[][];
  /** `route`: real driving times, `estimate`: estimated from the air-line distance. */
  travelSource: 'route' | 'estimate';
  rows: StaffNikolausDispoRow[];
  /** Version of the saved rows; saving fails if someone else saved in between. */
  version: string;
  /** Bookings of the day that are not confirmed yet and therefore not planned. */
  pendingCount: number;
  /** Helpers per team from the saved Einteilung. */
  members: Record<string, StaffNikolausTeamMember[]>;
}

export interface StaffNikolausTeamMember {
  personId: string;
  name: string;
  role: string;
  negativeTags: string[];
  positiveTags: string[];
}

export interface StaffNikolausDispoSaved {
  rows: StaffNikolausDispoRow[];
  version: string;
}

/** A visit of a team's route in the Fahrt view, with what the team needs at the door. */
export interface StaffNikolausFahrtStop {
  visitVersion: string;
  bookingId: string;
  order: number;
  plannedArrival: string;
  /** Current slot of the booking. */
  slotKey: string;
  /** The booking was moved to another slot after the Dispo was saved. */
  moved: boolean;
  visited: boolean;
  visitedAt: string;
  familyName: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  addressNotes: string;
  childrenCount: number;
  withKrampus: boolean;
  hidingPlace: string;
  notes: string;
  location: NikolausLocation | null;
}

/** The routes of all teams of a day as saved in the Dispo. */
export interface StaffNikolausFahrtData {
  date: string;
  teams: { name: string; color: string }[];
  base: { name: string; lat: number; lon: number };
  /** Whether a Dispo was saved for the day at all. */
  dispoSaved: boolean;
  /** Visits per team name in route order. */
  routes: Record<string, StaffNikolausFahrtStop[]>;
  members: Record<string, { name: string; role: string }[]>;
  /** Confirmed bookings of the day that are missing in the saved Dispo. */
  unplannedCount: number;
  /** Rows of the Dispo whose booking is no longer confirmed on this day. */
  droppedCount: number;
}

export interface StaffNikolausFahrtVisit {
  visitVersion: string;
  bookingId: string;
  visited: boolean;
  visitedAt: string;
}

/** A helper of the Nikolausdienst. */
export interface StaffNikolausHelper {
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  name: string;
  /** Posts per day (`YYYY-MM-DD`). */
  availability: Record<string, NikolausHelperRole[]>;
  positiveTags: string[];
  negativeTags: string[];
  notes: string;
}

export interface StaffNikolausHelfendeData {
  persons: StaffNikolausHelper[];
  /** All tags in use, for suggestions. */
  tags: string[];
  days: { date: string; teams: string[] }[];
}

/** A suggested Stufen tag from the Stufen-Abgleich (CampFlow member list, Leitende list). */
export interface StaffNikolausStufenSuggestion {
  id: string;
  /** `booking`: tag for a family; `helper`: negative tag for a helper. */
  kind: 'booking' | 'helper';
  targetId: string;
  targetName: string;
  stufe: string;
  /** `name-address`: surname and address match; `address`: only the address matches. */
  match: 'name-address' | 'address' | 'leitung';
  evidence: string[];
}

export interface StaffNikolausStufenData {
  suggestions: StaffNikolausStufenSuggestion[];
}

export interface StaffNikolausEinteilungRow {
  personId: string;
  date: string;
  team: string;
  role: NikolausHelperRole;
  fixed: boolean;
}

export interface StaffNikolausEinteilungData {
  persons: StaffNikolausHelper[];
  days: EinteilungDay[];
  rows: StaffNikolausEinteilungRow[];
  version: string;
}
