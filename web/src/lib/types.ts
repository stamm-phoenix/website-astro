import type { NikolausBookingDetails } from './nikolausConfig';

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

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasImage: boolean;
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
  id: string;
  /** Local slot key, e.g. `2026-12-05T17:00`; may point to a slot no longer configured. */
  slotKey: string;
  status: NikolausBookingStatus;
  location: NikolausLocation | null;
  reservedUntil: string | null;
  confirmedAt: string | null;
  changedAt: string | null;
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

export interface StaffDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasPreview: boolean;
}
