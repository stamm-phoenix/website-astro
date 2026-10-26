import type { NikolausBookingDetails, NikolausSettings } from './nikolausConfig';
import type { EinteilungDay, HelperRole as NikolausHelperRole } from './nikolausEinteilung';

export interface Leitende {
  id: string;
  name: string;
  teams: string[];
  hasImage: boolean;
}

export interface Vorstand {
  id: string;
  name: string;
  telephone?: string;
  street?: string;
  city?: string;
  hasImage: boolean;
}

export interface GruppenstundeLeitende {
  id: string;
  name: string;
  hasImage: boolean;
}

export interface Gruppenstunde {
  id: string;
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  ageRange: string;
  description: string;
  leitende: GruppenstundeLeitende[];
}

export interface Aktion {
  id: string;
  stufen: string[];
  title: string;
  campflow_link?: string;
  description?: string;
  start: string;
  end: string;
}

export interface DownloadFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  /** There are preview images (`/api/downloads/<id>/image/<size>`). */
  hasPreview: boolean;
  createdAt: string;
  lastModifiedAt: string;
}

export type GroupKey = 'Woelflinge' | 'Jungpfadfinder' | 'Pfadfinder' | 'Rover';

export const STUFE_TO_KEY: Record<string, GroupKey> = {
  Wölflinge: 'Woelflinge',
  Jungpfadfinder: 'Jungpfadfinder',
  Pfadfinder: 'Pfadfinder',
  Rover: 'Rover',
};

export const STUFE_ORDER: Record<string, number> = {
  Wölflinge: 1,
  Jungpfadfinder: 2,
  Pfadfinder: 3,
  Rover: 4,
};

export const GROUP_CONFIG: Record<GroupKey, { color: string; logo: string; label: string }> = {
  Woelflinge: {
    color: 'var(--color-dpsg-woelflinge)',
    logo: '/stufen/woelflinge.webp',
    label: 'Wölflinge',
  },
  Jungpfadfinder: {
    color: 'var(--color-dpsg-jupfis)',
    logo: '/stufen/jungpfadfinder.webp',
    label: 'Jungpfadfinder',
  },
  Pfadfinder: {
    color: 'var(--color-dpsg-pfadfinder)',
    logo: '/stufen/pfadfinder.webp',
    label: 'Pfadfinder',
  },
  Rover: {
    color: 'var(--color-dpsg-rover)',
    logo: '/stufen/rover.webp',
    label: 'Rover',
  },
};

export interface BuildInfo {
  commit: string | null;
  shortCommit: string | null;
  commitUrl: string | null;
  builtAt: string;
}

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

/** Person families can call on their visit day (Steuerung). */
export interface NikolausDayContact {
  name: string;
  phone: string;
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

/** Logged-in user as returned by the Static Web Apps endpoint `/.auth/me`. */
export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: { typ: string; val: string }[];
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

/** A custom field defined for a CampFlow list. */
export interface CampflowColumn {
  id: string;
  name: string;
  type: string;
  allowed_values: string[] | null;
  external_id: string | null;
}

/** A participant; standard fields plus custom fields as `col_…` / `custom_…` keys. */
export interface CampflowPerson {
  id: string;
  [key: string]: unknown;
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

/** An entry of the public calendar as edited in the Leitendenbereich. */
export interface StaffAktion {
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  /** CampFlow event the entry was published from; then title, dates and link come from there. */
  campflowId: string | null;
  title: string;
  stufen: string[];
  /** `YYYY-MM-DD`; for linked entries the copy of the CampFlow dates. */
  start: string;
  end: string;
  link: string;
  description: string;
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

/** A Kostenstelle in CampFlow's Kasse; Einzelnachweise are filtered by it. */
export interface Kostenstelle {
  id: string;
  name: string;
  archived: boolean;
  /** Kategorien of the Kostenstelle; a receipt is booked on one of them. */
  categories: { id: string; name: string }[];
}

/** Sum of the income or expenses of one category; `cent` is always positive. */
export interface KategorieSumme {
  category: string;
  cent: number;
  count: number;
}

/** A person of the Abrechnung: a confirmed registration or one added on the page. */
export interface AbrechnungPerson {
  /** CampFlow's person ID, or `extra-…` for persons added on the page. */
  id: string;
  lastName: string;
  firstName: string;
  gender: 'm' | 'w' | 'd' | '';
  /** On the first day of the Aktion. */
  age: number | null;
  plz: string;
  /** Where the person lives, as written in CampFlow (or entered for added persons). */
  ort?: string;
  herkunft: 'landkreis' | 'stadt' | 'andere' | 'unbekannt';
  /** From 27 on, the KJR counts a person as Betreuer*in. */
  betreuer: boolean;
}

/** A single income (positive) or expense (negative) of the Kostenstelle. */
export interface Nachweis {
  receiptNumber: string | null;
  type: string | null;
  description: string | null;
  category: string;
  paidBy: string | null;
  /** `YYYY-MM-DD` */
  date: string | null;
  cent: number;
}

/** Financial overview of an Aktion (Leitendenbereich → Abrechnung). */
export interface Abrechnung {
  event: Pick<
    CampflowEvent,
    'id' | 'title' | 'start_date' | 'end_date' | 'zuschussfaehig' | 'keineAktion'
  >;
  costUnit: { id: string; name: string };
  /** Confirmed registrations, only the fields relevant for the Abrechnung. */
  persons: AbrechnungPerson[];
  /**
   * IDs of the own registrations, matched on the server by address (`docs/personen.md`); `null`
   * when it could not compare, then the names decide.
   */
  ich?: string[] | null;
  bilanz: {
    incomeCent: number;
    /** Positive sum of all expenses. */
    expenseCent: number;
    resultCent: number;
    income: KategorieSumme[];
    expenses: KategorieSumme[];
    entryCount: number;
  };
  nachweise: Nachweis[];
  /** When the Einzelnachweise were exported from CampFlow (ISO 8601); null if unknown. */
  exportedAt: string | null;
  /** Fees for the Stamm's tents and material, set in the API's config. */
  leihgebuehren: LeihgebuehrenTarif;
}

export interface LeihgebuehrenTarif {
  /** Who decided the fees, e.g. „e.V.-Versammlung“. */
  beschlossenVon: string;
  /** Date of that decision (YYYY-MM-DD). */
  stand: string;
  material: { id: string; name: string; priceCentPerDay: number }[];
}

/** A Gruppenstunde as edited in the Leitendenbereich. */
export interface StaffGruppenstunde {
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  stufe: string;
  weekday: string;
  time: string;
  ageRange: string;
  location: string;
  /** Formatted description (a small subset of HTML). */
  description: string;
  leitende: GruppenstundeLeitende[];
}

export interface StaffGruppenstundenData {
  items: StaffGruppenstunde[];
  /** Stufen a Gruppenstunde can belong to (Team values of the Leitende list). */
  stufen: string[];
  weekdays: string[];
}

/** A person of the Leitende list as edited in the Leitendenbereich. */
export interface StaffLeitende {
  id: string;
  etag: string;
  name: string;
  teams: string[];
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  hasImage: boolean;
}

export interface StaffLeitendeData {
  items: StaffLeitende[];
  teams: string[];
}

/** The Kasse accepts a receipt (then transfers it to CampFlow) or rejects it with a reason. */
export type BelegStatus = 'Eingereicht' | 'Angenommen' | 'Abgelehnt';

/** Preliminary check of a receipt photo by the image model. */
export interface BelegCheck {
  /** Receipt, complete and readable: fit for the archive. */
  ok: boolean;
  isReceipt: boolean;
  complete: boolean;
  readable: boolean;
  issues: string[];
  /** Positions not suitable for youth work, e.g. alcohol or tobacco; a hint for the Kasse. */
  restrictedItems: string[];
  shop: string | null;
  date: string | null;
  amountCent: number | null;
  checkedAt: string;
}

/** A receipt uploaded for the Kassenteam. */
export interface StaffBeleg {
  id: string;
  etag: string;
  shop: string;
  /** Date of the receipt, `YYYY-MM-DD`. */
  date: string;
  amountCent: number;
  /** Who gets the Auslage back, also „Sparbuch“; empty when the Stamm paid. */
  paidBy: string;
  /** Whether it is an Auslage: someone or the savings book gets the money. */
  payout: boolean;
  /** Older receipts only; newer ones name Kostenstelle and Kategorie. */
  aktion: string;
  /** Name of the Kostenstelle in CampFlow; may not exist there yet. */
  kostenstelle: string;
  /** Name of the Kategorie; may not exist in the Kostenstelle yet. */
  kategorie: string;
  note: string;
  status: BelegStatus;
  /** Remark of the Kasse; for a rejected receipt the reason mailed to the uploader. */
  reviewNote: string;
  /** Login of the person who uploaded the receipt. */
  submittedBy: string;
  submittedAt: string;
  hasImage: boolean;
  /** Whether the unedited photo is stored next to the scan. */
  hasOriginal: boolean;
  aiCheck: BelegCheck | null;
  /** The last transfer to CampFlow; null if there was none. */
  campflow: BelegCampflow | null;
  /** Someone else submitted the user's Auslage: they may look at it, not change it. */
  readOnly?: true;
  /** An Auslage of the logged-in user, as the server knows their names. */
  mine?: true;
}

/**
 * Transfer of a receipt to CampFlow. `Gestartet`: running or result unclear, repeating it is
 * safe; `Fehlgeschlagen`: nothing was created; `Hochgeladen`: booked under `number`.
 */
export interface BelegCampflow {
  state: 'Gestartet' | 'Fehlgeschlagen' | 'Hochgeladen';
  costUnitId: string;
  costUnitName: string;
  categoryId: string;
  categoryName: string;
  number: string | null;
  error: string;
  startedBy: string;
  startedAt: string;
}

/**
 * Where a receipt stands in CampFlow: `unbooked` uploaded but not booked („Ungeprüfte Belege“),
 * `open` booked but not fully matched to a payment (an Auslage is not paid back yet), `settled`
 * matched in full (paid, or paid back).
 */
export type CampflowBelegStatus = 'unbooked' | 'open' | 'settled';

/** A receipt as CampFlow's page „Belege“ lists it (`GET /api/intern/pflege/belege/campflow`). */
export interface CampflowBeleg {
  /** The booking (`exp_…`), or for an unbooked receipt the receipt (`rcp_…`). */
  id: string;
  /** Belegnummer like `2026-94`, null until booked. */
  number: string | null;
  status: CampflowBelegStatus;
  description: string;
  /** Belegdatum `YYYY-MM-DD`, null for an unbooked receipt. */
  date: string | null;
  /** Negative for expenses, positive for income. */
  amountCent: number;
  /** Part not yet matched to a payment, with the amount's sign. */
  openCent: number;
  /** „Auslage durch“: who paid out of pocket. */
  paidBy: string | null;
  costUnits: { id: string; name: string }[];
  categories: { id: string; name: string; costUnitId: string | null }[];
  pages: number;
  /** File name in CampFlow, only for unbooked receipts. */
  fileName: string | null;
  /** Upload time as CampFlow reports it, `YYYY-MM-DD HH:MM:SS`. */
  uploadedAt: string | null;
  /** When a `settled` receipt was paid or paid back, `YYYY-MM-DD`; null otherwise or if unknown. */
  settledAt: string | null;
  /** Transferred from this website's Belege module. */
  viaWebsite: boolean;
  /** Transferred from the Belege module and submitted there by the logged-in user. */
  submittedByMe: boolean;
  /** „Auslage durch“ names the logged-in user, as the server knows their names. */
  mine: boolean;
}

export interface CampflowBelegeData {
  /** When the receipts were read from CampFlow (ISO 8601). */
  loadedAt: string;
  costUnits: {
    id: string;
    name: string;
    archived: boolean;
    categories: { id: string; name: string }[];
  }[];
  belege: CampflowBeleg[];
}

export interface StaffDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasPreview: boolean;
  /** Version for renaming and deleting. */
  etag: string;
}

/** `Archiv`: a file without review state, e.g. minutes from before this module. */
export type ProtokollStatus = 'Entwurf' | 'Review' | 'Freigegeben' | 'Verschickt' | 'Archiv';

/** Minutes of a meeting: a Word file in SharePoint with its review state. */
export interface StaffProtokoll {
  id: string;
  /** Version of the library item; changes with every edit of the file, too. */
  etag: string;
  fileName: string;
  title: string;
  /** Date of the meeting, `YYYY-MM-DD`, or empty for files without a date in their name. */
  date: string;
  status: ProtokollStatus;
  /** Opens the file in Word for the web. */
  webUrl: string;
  /** Login of the person who created the minutes. */
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  /** Why the minutes were sent back from the review. */
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  /** Edited after the approval; must be reviewed again before sending. */
  changedSinceApproval: boolean;
  /** `attempted` without `sent`: the mail may or may not have gone out. */
  delivery: { state: 'attempted' | 'sent'; recipients: number; at: string; by: string } | null;
  /** Date of the next Leitendenrunde read from approved minutes; null before the first reading. */
  termin: ProtokollTermin | null;
  /** The file was edited after the approval; the suggestion no longer matches it. */
  terminStale: boolean;
}

/** Result of reading the next meeting from the minutes. */
export type ProtokollTerminExtraction =
  'gefunden' | 'unklar' | 'nicht gefunden' | 'fehler' | 'nicht eingerichtet' | 'nicht ausgefuehrt';

export type ProtokollTerminDecision = 'offen' | 'bestaetigt' | 'abgelehnt';

/** Next Leitendenrunde: the automatic suggestion and the decision of a leader. */
export interface ProtokollTermin {
  /** Version of the file the suggestion was read from. */
  sourceVersion: string;
  extraction: ProtokollTerminExtraction;
  suggestion: {
    /** `YYYY-MM-DD` */
    date: string | null;
    /** `HH:MM` */
    time: string | null;
    place: string | null;
    /** Passage of the minutes the suggestion comes from. */
    quote: string | null;
  };
  decision: ProtokollTerminDecision;
  confirmed: { date: string; time: string | null; place: string | null } | null;
  decidedBy: string;
  decidedAt: string;
  extractedAt: string;
}

/** Body of `POST /intern/pflege/protokolle/{id}/termin`. */
export interface ProtokollTerminRequest {
  action: 'erkennen' | 'bestaetigen' | 'ablehnen';
  etag: string;
  date?: string;
  time?: string;
  place?: string;
}

export interface StaffProtokolleData {
  /** Whether the document library was found. */
  configured: boolean;
  /** Preset title of new minutes. */
  defaultTitle: string;
  /** Whether a sender mailbox is set up. */
  sendingConfigured: boolean;
  /** Whether meeting-date recognition is enabled in the current deployment. */
  terminConfigured: boolean;
  login: string;
  items: StaffProtokoll[];
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

export interface InstagramPost {
  id: string;
  caption?: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  timestamp: string;
  /** Number of images; more than one for carousels */
  imageCount: number;
  /** Whether the video can be played on the site; missing e.g. for reels with licensed music */
  hasVideo: boolean;
}

/** Cover image of a blog post. */
export interface BlogCover {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/** A published blog post as listed on the website. */
export interface BlogPostSummary {
  id: string;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  excerpt: string;
  readingMinutes: number;
  cover?: BlogCover;
}

/** A published blog post with its content (sanitized HTML with complete image tags). */
export interface BlogPost extends BlogPostSummary {
  content: string;
}

/** An image attached to a blog post; the first one is the cover image. */
export interface BlogImage {
  file: string;
  alt: string;
  width: number;
  height: number;
}

/** A blog post in the list of the Leitendenbereich, including drafts. */
export interface StaffBlogListItem {
  id: string;
  title: string;
  date: string;
  published: boolean;
  cover: BlogImage | null;
  imageCount: number;
  textLength: number;
}

/** A blog post as edited in the Leitendenbereich. */
export interface StaffBlogPost {
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  title: string;
  date: string;
  published: boolean;
  /** Canonical HTML with `<img data-bild="…">` placeholders for the images. */
  content: string;
  images: BlogImage[];
}

export interface QuestionAndAnswer {
  id: string;
  question: string;
  answer: string;
  category: string;
}

/** FAQ entry in the Leitendenbereich, including the version for safe changes. */
export interface StaffQuestionAndAnswer extends QuestionAndAnswer {
  published: boolean;
  etag: string;
}

export interface StaffQuestionsData {
  items: StaffQuestionAndAnswer[];
  categories: string[];
  allowCustomCategories: boolean;
}

/**
 * Determines whether a value contains a valid question-and-answer entry.
 *
 * @param item - The value to inspect
 * @returns `true` if the value has string `id`, `question`, `answer`, and `category` fields, `false` otherwise.
 */
function isQuestionAndAnswer(item: unknown): item is QuestionAndAnswer {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.question === 'string' &&
    typeof candidate.answer === 'string' &&
    typeof candidate.category === 'string'
  );
}

/**
 * Validates a public Q&A API response.
 *
 * @param value - The untrusted API response to validate
 * @returns The validated list of Q&A entries
 * @throws A `TypeError` if the response does not contain valid Q&A entries
 */
export function parseQuestionsAndAnswers(value: unknown): QuestionAndAnswer[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid Q&A response');
  }

  if (!value.every(isQuestionAndAnswer)) {
    throw new TypeError('Invalid Q&A response');
  }

  return value;
}

export type {
  SammelArtikel,
  SammelKatalogArtikel,
  SammelAktion,
  SammelBestellung,
  SammelMemberView,
  SammelSaveResult,
  SammelProductInfo,
  SammelStaffView,
  SammelStatus,
  SammelPaymentSummary,
} from '../../../api/lib/sammelbestellung-model';

export type {
  SammelBillingPerson,
  SammelPaymentRecord,
  SammelPaymentView,
  SammelPaymentPreview,
  SammelPaymentEvent,
} from '../../../api/lib/sammelbestellung-payment-model';

export type {
  AnwesenheitChild,
  AnwesenheitGuest,
  AnwesenheitMeeting,
  AnwesenheitOverview,
  AnwesenheitStatus,
  AnwesenheitStufe,
  AnwesenheitTermin,
} from '../../../api/lib/anwesenheit-model';

export type {
  Task,
  TaskInput,
  TaskProject,
  TaskTemplate,
  TemplateItem,
  TasksOverview,
  TaskAssignment,
} from '../../../api/lib/aufgaben-model';

export type {
  ProtokollAktion,
  OffeneAufgabe,
  OffeneAufgabeQuelle,
  ProtokollAnwesenheit,
  ProtokollAufgabe,
  ProtokollEditorAblage,
  ProtokollEditorAufgaben,
  ProtokollEditorDetail,
  ProtokollEditorListItem,
  ProtokollEditorOverview,
  ProtokollEditorPersonen,
  ProtokollEditorStatus,
  ProtokollEditorVersand,
  ProtokollFreigabeResponse,
  ProtokollInhalt,
  ProtokollKopf,
  ProtokollLiveResponse,
  ProtokollNaechsteSitzung,
  ProtokollPerson,
  ProtokollProjekt,
  ProtokollProjektOption,
  ProtokollPunkt,
  ProtokollReviewAction,
  ProtokollRevision,
  ProtokollRevisionListItem,
  ProtokollRevisionReason,
  ProtokollSaveResponse,
  ProtokollSperre,
  ProtokollTeilnahme,
  PunktTermin,
  PersonGruppe,
  PersonOption,
} from '../../../api/lib/protokoll-editor-model';
export type {
  CampflowMitglied,
  Ich,
  LeitendenKonto,
  Person,
  PersonenUebersicht,
} from '../../../api/lib/personen-model';

/** A folder of the photo library (module „Fotos“). */
export interface FotoFolder {
  name: string;
  /** Path inside the library, e.g. `2026/Sommerlager`. */
  path: string;
  childCount: number | null;
  webUrl: string;
}

/** A file of the photo library; links expire after about an hour. */
export interface FotoFile {
  id: string;
  name: string;
  size: number;
  kind: 'photo' | 'video' | 'file';
  thumbnailUrl: string | null;
  takenAt: string | null;
  modifiedAt: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  webUrl: string;
  downloadUrl: string | null;
}

export interface FotoFolderContent {
  /** Empty for the top folder of the library. */
  path: string;
  name: string;
  webUrl: string;
  folders: FotoFolder[];
  files: FotoFile[];
}

export interface FotoFileDetail {
  id: string;
  name: string;
  kind: 'photo' | 'video' | 'file';
  imageUrl: string | null;
  downloadUrl: string | null;
  /** SharePoint's player for videos. */
  embedUrl: string | null;
  webUrl: string;
}

/** Folder an upload goes to, created by the API if missing. */
export interface FotoTarget {
  path: string;
  webUrl: string;
}

/** `name` is the name the file has or gets in SharePoint; it can differ from the one asked for. */
export type FotoUploadSession =
  | { exists: true; name: string }
  | { exists: false; name: string; uploadUrl: string; expiresAt: string | null };

/** Where a Beitrag stands in CampFlow (Leitendenbereich → Beiträge). */
export type BeitragStatus = 'paid' | 'unpaid' | 'partial' | 'refund' | 'cancelled';

/** A Sammlung of CampFlow's Beiträge: the fees of an Aktion, a Mitgliedsbeitrag or others. */
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

/**
 * A Beitrag of a participant of an Aktion, as CampFlow lists it next to the person (without
 * payer and payment date).
 */
export interface AktionBeitrag {
  id: string;
  /** Verwendungszweck of the transfer. */
  reference: string;
  description: string;
  /** As CampFlow lists it; for a cancelled Beitrag the amount cancelled. */
  amountCent: number;
  dueCent: number;
  paidCent: number;
  /** Negative when paid too much. */
  openCent: number;
  status: BeitragStatus;
}

/** One Beitrag: who has to pay how much for what, and what was paid. */
export interface Beitrag extends AktionBeitrag {
  batchId: string | null;
  costUnit: { id: string; name: string } | null;
  category: string | null;
  payer: string;
  /** CampFlow's ID of the payer (member or registration, `per_…`); null if unknown. */
  payerId: string | null;
  paymentMethod: string | null;
  /** Day the Beitrag was created, `YYYY-MM-DD`. */
  date: string;
  /** Day of the latest payment, `YYYY-MM-DD`; null if none. */
  paidAt: string | null;
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

/** Gemeinnützige Sphäre of a CampFlow Kategorie. */
export type KostenstellenSphaere = 'ideal' | 'purpose' | 'assets' | 'business';

/** Sums of a Kostenstelle or Kategorie in euro cents; expenses are negative. */
export interface KostenstellenSummen {
  incomeCent: number;
  expensesCent: number;
  balanceCent: number;
  /** Income not yet matched to a payment, e.g. unpaid Beiträge. */
  openIncomeCent: number;
  /** Expenses not yet matched to a payment, e.g. Auslagen not paid back yet; negative. */
  openExpensesCent: number;
  bookings: number;
}

export interface JahresSummen extends KostenstellenSummen {
  year: number;
}

export interface KategorieStatistik extends KostenstellenSummen {
  /** null for a Kategorie with bookings that the Kostenstelle no longer lists. */
  id: string | null;
  /** "" for bookings without a Kategorie. */
  name: string;
  sphere: KostenstellenSphaere | null;
}

export interface KostenstelleStatistik extends KostenstellenSummen {
  /** null for a Kostenstelle with bookings that CampFlow no longer lists. */
  id: string | null;
  name: string;
  color: string | null;
  archived: boolean;
  /** Calendar years with at least one booking, ascending. */
  years: number[];
  /** The sums of each of these years. */
  yearTotals: JahresSummen[];
  categories: KategorieStatistik[];
}

/** Sums per CampFlow Kostenstelle and Kategorie (`GET /api/intern/kostenstellen`). */
export interface KostenstellenData {
  /** When CampFlow's report was exported (ISO 8601). */
  loadedAt: string;
  costUnits: KostenstelleStatistik[];
}
