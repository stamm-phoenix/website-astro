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
const CHILDREN: Record<string, { id: string; firstName: string; lastName: string }[]> = {
  woelflinge: [
    { id: 'per_W1', firstName: 'Anna', lastName: 'Test' },
    { id: 'per_W2', firstName: 'Ben', lastName: 'Beispiel' },
    { id: 'per_W3', firstName: 'Clara', lastName: 'Muster' },
    { id: 'per_W4', firstName: 'David', lastName: 'Probe' },
  ],
  jungpfadfinder: [
    { id: 'per_J1', firstName: 'Emil', lastName: 'Test' },
    { id: 'per_J2', firstName: 'Frieda', lastName: 'Beispiel' },
  ],
  pfadfinder: [{ id: 'per_P1', firstName: 'Greta', lastName: 'Muster' }],
  rover: [],
};

export const ANWESENHEIT_STUFEN: Record<string, string> = {
  woelflinge: 'Wölflinge',
  jungpfadfinder: 'Jungpfadfinder',
  pfadfinder: 'Pfadfinder',
  rover: 'Rover',
};

interface MockMeeting {
  etag: string;
  notes: string;
  present: string[];
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

/** A Termin of each Stufe from last week, so the Verlauf shows something. */
for (const slug of Object.keys(ANWESENHEIT_STUFEN)) {
  const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  meetings.set(key(slug, date), {
    etag: newEtag(`anwesenheit-${slug}`),
    notes: 'Knoten geübt und eine Seilbrücke gebaut.',
    present: CHILDREN[slug].slice(0, 2).map((child) => child.id),
    guests: [],
  });
}

export function isAnwesenheitDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today();
}

export function anwesenheitOverview(ownStufen: string[]): AnwesenheitOverview {
  const summaries: AnwesenheitMeeting[] = [...meetings.entries()].map(([id, meeting]) => {
    const [slug, date] = id.split('/');
    return {
      stufe: ANWESENHEIT_STUFEN[slug],
      date,
      members: meeting.present.length,
      guests: meeting.guests.length,
      notes: meeting.notes,
    };
  });
  return {
    today: today(),
    editableFrom: editableFrom(),
    stufen: Object.entries(ANWESENHEIT_STUFEN).map(([slug, stufe]) => {
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

export function anwesenheitTermin(slug: string, date: string): AnwesenheitTermin {
  const meeting = meetings.get(key(slug, date));
  const present = new Set(meeting?.present ?? []);
  const children: AnwesenheitChild[] = CHILDREN[slug].map((child) => ({
    ...child,
    present: present.has(child.id),
    otherStufe: false,
    known: true,
  }));
  return {
    stufe: ANWESENHEIT_STUFEN[slug],
    date,
    editable: date >= editableFrom(),
    etag: meeting?.etag ?? null,
    notes: meeting?.notes ?? '',
    children,
    anonymized: 0,
    guests: meeting?.guests ?? [],
    anonymizedGuests: 0,
  };
}

function meetingOf(slug: string, date: string): MockMeeting {
  const id = key(slug, date);
  const existing = meetings.get(id);
  if (existing) return existing;
  const created: MockMeeting = {
    etag: newEtag(`anwesenheit-${id}`),
    notes: '',
    present: [],
    guests: [],
  };
  meetings.set(id, created);
  return created;
}

/** `false` if the child is not a current member, as the API answers with 404. */
export function setAnwesenheitPresent(
  slug: string,
  date: string,
  id: string,
  present: boolean
): boolean {
  if (!present) {
    const meeting = meetings.get(key(slug, date));
    if (meeting) meeting.present = meeting.present.filter((p) => p !== id);
    return true;
  }
  if (!Object.values(CHILDREN).some((list) => list.some((child) => child.id === id))) return false;
  const meeting = meetingOf(slug, date);
  if (!meeting.present.includes(id)) meeting.present.push(id);
  return true;
}

/** The new etag, or `null` if the notes changed since `etag` was loaded. */
export function saveAnwesenheitNotes(
  slug: string,
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

export function addAnwesenheitGuest(slug: string, date: string, name: string): AnwesenheitGuest {
  const guest = { id: newId(), name };
  meetingOf(slug, date).guests.push(guest);
  return guest;
}

export function removeAnwesenheitGuest(slug: string, date: string, id: string): void {
  const meeting = meetings.get(key(slug, date));
  if (meeting) meeting.guests = meeting.guests.filter((guest) => guest.id !== id);
}
