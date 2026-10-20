/**
 * Shapes of the Anwesenheit API (`docs/anwesenheit.md`). Shared with the frontend
 * (`web/src/lib/types.ts`), so keep this module free of imports and Node/browser-specific APIs.
 */

/** URL names of the Stufen, the same keys as the filters of `web/src/lib/events.ts`. */
export const STUFE_SLUGS = {
  woelflinge: 'Wölflinge',
  jupfis: 'Jungpfadfinder',
  pfadis: 'Pfadfinder',
  rover: 'Rover',
} as const;

export type StufeSlug = keyof typeof STUFE_SLUGS;
export type AnwesenheitStufeName = (typeof STUFE_SLUGS)[StufeSlug];

export function isStufeSlug(value: string): value is StufeSlug {
  return Object.hasOwn(STUFE_SLUGS, value);
}

/** A Stufe with the day and time of its Gruppenstunde (empty if unknown). */
export interface AnwesenheitStufe {
  stufe: AnwesenheitStufeName;
  slug: StufeSlug;
  weekday: string;
  time: string;
}

/** A recorded Termin with its counts. */
export interface AnwesenheitMeeting {
  stufe: AnwesenheitStufeName;
  date: string;
  /** Children of the member list who were there, including anonymized ones. */
  members: number;
  /** Children of the member list who were excused, including anonymized ones. */
  excused: number;
  guests: number;
  notes: string;
  /** The Gruppenstunde did not take place; it has no attendance. */
  cancelled: boolean;
}

export interface AnwesenheitOverview {
  today: string;
  stufen: AnwesenheitStufe[];
  /** Stufen the logged-in person leads, as a suggestion. */
  ownStufen: string[];
  meetings: AnwesenheitMeeting[];
}

/** What is recorded for a child at a Termin; `abwesend` has no row in the database. */
export const ANWESENHEIT_STATUS = ['anwesend', 'entschuldigt', 'abwesend'] as const;

export type AnwesenheitStatus = (typeof ANWESENHEIT_STATUS)[number];

/** A child of the Stufe, or one from another Stufe who was there or excused. */
export interface AnwesenheitNamedChild {
  kind: 'stufe' | 'besuch';
  id: string;
  firstName: string;
  lastName: string;
  status: AnwesenheitStatus;
}

/** A child who was there or excused but is no longer in CampFlow. */
export interface AnwesenheitUnknownChild {
  kind: 'unbekannt';
  id: string;
  status: AnwesenheitStatus;
}

export type AnwesenheitChild = AnwesenheitNamedChild | AnwesenheitUnknownChild;

export interface AnwesenheitGuest {
  id: string;
  name: string;
}

export interface AnwesenheitTermin {
  stufe: AnwesenheitStufeName;
  date: string;
  editable: boolean;
  /** Version of the notes and of `cancelled`, `null` while the Termin does not exist yet. */
  etag: string | null;
  notes: string;
  cancelled: boolean;
  children: AnwesenheitChild[];
  /** Children who were there, whose IDs were removed after the retention period. */
  anonymized: number;
  /** Children who were excused, whose IDs were removed after the retention period. */
  anonymizedExcused: number;
  guests: AnwesenheitGuest[];
  /** Guests whose names were removed after the retention period. */
  anonymizedGuests: number;
}
