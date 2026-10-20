import type { StufeSlug } from '../../../api/lib/anwesenheit-model';
import { STUFE_SLUGS, attendanceSnapshot, isStufeSlug } from '../../../api/lib/anwesenheit-model';
import type {
  AnwesenheitChild,
  AnwesenheitGuest,
  AnwesenheitMeeting,
  AnwesenheitOverview,
  AnwesenheitTermin,
} from '../../src/lib/types';
import { gruppenstunden } from './people';
import { newEtag, newId } from './util';

/** Invented children of the CampFlow member list per Stufe slug. */
const CHILDREN: Record<StufeSlug, { id: string; firstName: string; lastName: string }[]> = {
  woelflinge: [
    { id: 'per_W1', firstName: 'Anna', lastName: 'Test' },
    { id: 'per_W2', firstName: 'Ben', lastName: 'Beispiel' },
    { id: 'per_W3', firstName: 'Clara', lastName: 'Muster' },
    { id: 'per_W4', firstName: 'David', lastName: 'Probe' },
  ],
  jupfis: [
    { id: 'per_J1', firstName: 'Emil', lastName: 'Test' },
    { id: 'per_J2', firstName: 'Frieda', lastName: 'Beispiel' },
  ],
  pfadis: [{ id: 'per_P1', firstName: 'Greta', lastName: 'Muster' }],
  rover: [],
};

interface MockMeeting {
  slug: StufeSlug;
  date: string;
  etag: string;
  notes: string;
  cancelled: boolean;
  present: string[];
  excused: string[];
  guests: AnwesenheitGuest[];
}

const meetings = new Map<string, MockMeeting>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Twelve months before today, as in `CONFIG.anwesenheit.retentionMonths`. */
function editableFrom(): string {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 12);
  return date.toISOString().slice(0, 10);
}

function key(slug: string, date: string): string {
  return `${slug}/${date}`;
}

/** Days ago and notes of the invented Termine; the Verlauf and its chart show them. */
const PAST: { days: number; notes: string; cancelled?: boolean }[] = [
  { days: 7, notes: 'Knoten geübt und eine Seilbrücke gebaut.' },
  { days: 14, notes: '' },
  { days: 21, notes: 'Fällt aus wegen der Ferien.', cancelled: true },
  { days: 49, notes: 'Geländespiel im Wald.' },
  { days: 84, notes: 'Lagerfeuer mit Stockbrot.' },
];

for (const slug of Object.keys(STUFE_SLUGS).filter(isStufeSlug)) {
  for (const [index, { days, notes, cancelled = false }] of PAST.entries()) {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ids = CHILDREN[slug].map((child) => child.id);
    meetings.set(key(slug, date), {
      slug,
      date,
      etag: newEtag(`anwesenheit-${slug}`),
      notes,
      cancelled,
      present: cancelled ? [] : ids.slice(0, 2 + (index % 2)),
      excused: cancelled ? [] : ids.slice(3, 4),
      guests: [],
    });
  }
}

/** The Stufe of a route with a date that is not in the future, as the API accepts it. */
export function anwesenheitSlug(slug: string, date: string): StufeSlug | undefined {
  return isStufeSlug(slug) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today()
    ? slug
    : undefined;
}

export function anwesenheitOverview(ownStufen: string[]): AnwesenheitOverview {
  const summaries: AnwesenheitMeeting[] = [...meetings.values()].map((meeting) => {
    return {
      stufe: STUFE_SLUGS[meeting.slug],
      date: meeting.date,
      members: meeting.present.length,
      excused: meeting.excused.length,
      guests: meeting.guests.length,
      notes: meeting.notes,
      cancelled: meeting.cancelled,
    };
  });
  return {
    today: today(),
    stufen: Object.keys(STUFE_SLUGS)
      .filter(isStufeSlug)
      .map((slug) => {
        const stufe = STUFE_SLUGS[slug];
        const gruppenstunde = gruppenstunden.find((g) => g.stufe === stufe);
        return {
          stufe,
          slug,
          weekday: gruppenstunde?.weekday ?? '',
          time: gruppenstunde?.time ?? '',
        };
      }),
    ownStufen,
    meetings: summaries.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function anwesenheitTermin(slug: StufeSlug, date: string): AnwesenheitTermin {
  const meeting = meetings.get(key(slug, date));
  const children: AnwesenheitChild[] = CHILDREN[slug].map((child) => ({
    kind: 'stufe',
    ...child,
    status: meeting?.present.includes(child.id)
      ? 'anwesend'
      : meeting?.excused.includes(child.id)
        ? 'entschuldigt'
        : 'abwesend',
  }));
  return {
    stufe: STUFE_SLUGS[slug],
    date,
    editable: date >= editableFrom(),
    etag: meeting?.etag ?? null,
    notes: meeting?.notes ?? '',
    cancelled: meeting?.cancelled ?? false,
    children,
    anonymized: 0,
    anonymizedExcused: 0,
    guests: meeting?.guests ?? [],
    anonymizedGuests: 0,
  };
}

function meetingOf(slug: StufeSlug, date: string): MockMeeting {
  const id = key(slug, date);
  const existing = meetings.get(id);
  if (existing) return existing;
  const created: MockMeeting = {
    slug,
    date,
    etag: newEtag(`anwesenheit-${id}`),
    notes: '',
    cancelled: false,
    present: [],
    excused: [],
    guests: [],
  };
  meetings.set(id, created);
  return created;
}

/**
 * `not-found` if the child is not a current member and `cancelled` while the Gruppenstunde is
 * marked as cancelled, as the API answers.
 */
export function markAnwesenheitChild(
  slug: StufeSlug,
  date: string,
  id: string,
  excused: boolean
): 'ok' | 'not-found' | 'cancelled' {
  if (!Object.values(CHILDREN).some((list) => list.some((child) => child.id === id))) {
    return 'not-found';
  }
  const meeting = meetingOf(slug, date);
  if (meeting.cancelled) return 'cancelled';
  markAnwesenheitAbsent(slug, date, id);
  (excused ? meeting.excused : meeting.present).push(id);
  return 'ok';
}

export function markAnwesenheitAbsent(slug: string, date: string, id: string): void {
  const meeting = meetings.get(key(slug, date));
  if (!meeting) return;
  meeting.present = meeting.present.filter((p) => p !== id);
  meeting.excused = meeting.excused.filter((p) => p !== id);
}

/**
 * Marks the Gruppenstunde as cancelled, which removes its attendance; returns the new etag, or
 * `null` if the Termin changed since `etag` was loaded or, when cancelling, has other than the
 * `entries` the page showed.
 */
export function setAnwesenheitCancelled(
  slug: StufeSlug,
  date: string,
  cancelled: boolean,
  etag: string | null,
  entries: number
): string | null {
  const meeting = meetingOf(slug, date);
  const unchanged = etag === null ? meeting.notes === '' : etag === meeting.etag;
  const recorded = meeting.present.length + meeting.excused.length + meeting.guests.length;
  if (!unchanged || (cancelled && recorded !== entries)) return null;
  meeting.cancelled = cancelled;
  if (cancelled) {
    meeting.present = [];
    meeting.excused = [];
    meeting.guests = [];
  }
  meeting.etag = newEtag(`anwesenheit-${slug}`);
  return meeting.etag;
}

/** `false` if the Termin changed since `etag` was loaded; a missing Termin is fine. */
export function deleteAnwesenheitTermin(
  slug: StufeSlug,
  date: string,
  etag: string,
  attendance: string
): boolean {
  const meeting = meetings.get(key(slug, date));
  if (!meeting) return true;
  if (meeting.etag !== etag || attendanceSnapshot(anwesenheitTermin(slug, date)) !== attendance)
    return false;
  meetings.delete(key(slug, date));
  return true;
}

/** The new etag, or `null` if the notes changed since `etag` was loaded. */
export function saveAnwesenheitNotes(
  slug: StufeSlug,
  date: string,
  notes: string,
  etag: string | null
): string | null {
  const meeting = meetingOf(slug, date);
  const unchanged = etag === null ? meeting.notes === '' : etag === meeting.etag;
  if (!unchanged) return null;
  meeting.notes = notes.trim();
  meeting.etag = newEtag(`anwesenheit-${slug}`);
  return meeting.etag;
}

/** `null` while the Gruppenstunde is marked as cancelled, as the API refuses it then. */
export function addAnwesenheitGuest(
  slug: StufeSlug,
  date: string,
  name: string
): AnwesenheitGuest | null {
  const meeting = meetingOf(slug, date);
  if (meeting.cancelled) return null;
  const guest = { id: newId(), name };
  meeting.guests.push(guest);
  return guest;
}

export function removeAnwesenheitGuest(slug: string, date: string, id: string): void {
  const meeting = meetings.get(key(slug, date));
  if (meeting) meeting.guests = meeting.guests.filter((guest) => guest.id !== id);
}
