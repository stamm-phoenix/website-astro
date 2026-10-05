import type { NikolausBookingDetails } from './nikolausConfig';
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
  downloadUrl?: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  thumbnails?: {
    large: string;
    medium: string;
    small: string;
  };
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
    logo: '/dpsg-lilie_woelflinge_orange.png',
    label: 'Wölflinge',
  },
  Jungpfadfinder: {
    color: 'var(--color-dpsg-jupfis)',
    logo: '/dpsg-lilie_jungpfadfinder_blau.png',
    label: 'Jungpfadfinder',
  },
  Pfadfinder: {
    color: 'var(--color-dpsg-pfadfinder)',
    logo: '/dpsg-lilie_pfadfinder_gruen.png',
    label: 'Pfadfinder',
  },
  Rover: {
    color: 'var(--color-dpsg-rover)',
    logo: '/lilie_rover.png',
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
}

/** How far the Nikolaus still is from the family. */
export type NikolausVisitProgress = NikolausVisitProgressWaiting | NikolausVisitProgressToday;

export interface NikolausLinkRequested {
  status: 'sent';
  /** Minimum minutes between two link mails for the same booking. */
  cooldownMinutes: number;
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

export interface CampflowEventDetail {
  event: CampflowEvent;
  columns: CampflowColumn[];
  persons: CampflowPerson[];
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
  /** Receipt, fully visible and readable: fit for the archive. */
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
  paidBy: string;
  /** Whether the person who paid gets the money back. */
  payout: boolean;
  aktion: string;
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
}

export interface StaffDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasPreview: boolean;
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
}

/** Everything the Dispo page needs for one day. */
export interface StaffNikolausDispoData {
  date: string;
  teams: { name: string; color: string }[];
  minutesPerChild: number;
  minVisitMinutes: number;
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
} from '../../../api/lib/sammelbestellung-model';
