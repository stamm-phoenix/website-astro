import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { Child, Guest, Termin } from '../lib/anwesenheit';
import {
  PERSON_ID_PATTERN,
  STUFE_SLUGS,
  addGuest,
  anonymizeExpired,
  berlinToday,
  getChildren,
  getMeetingRecord,
  getMeetingSummaries,
  ownStufen,
  removeGuest,
  retentionStart,
  saveNotes,
  setPresent,
  stufeFromSlug,
} from '../lib/anwesenheit';
import { campflowErrorResponse } from '../lib/campflow-api';
import { parseId } from '../lib/db';
import { getGruppenstunden } from '../lib/gruppenstunden-list';
import { getLeitende } from '../lib/leitende-list';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import {
  ValidationError,
  validateGuestName,
  validateMeetingNotes,
  validatePresence,
} from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import { getClaim, isStaffError, requireStaff } from '../lib/staff-auth';

const AREA = 'anwesenheit';

/** The Termin of a route, or `undefined` for an unknown Stufe or an invalid or future date. */
function readTermin(request: HttpRequest, now: Date): Termin | undefined {
  const stufe = stufeFromSlug(request.params.stufe);
  const date = request.params.datum ?? '';
  if (!stufe || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return undefined;
  if (date > berlinToday(now)) return undefined;
  return { stufe, date };
}

/** Termine before the retention start keep only their counts and cannot be changed. */
function requireEditable(termin: Termin, now: Date): void {
  if (termin.date < retentionStart(now)) {
    throw new ValidationError({
      date: 'Dieser Termin liegt vor der Aufbewahrungsfrist und kann nicht mehr geändert werden.',
    });
  }
}

/**
 * GET: the Gruppenstunden with their times, the Stufen the logged-in person leads (a
 * suggestion from the list „Leitende & Teams“) and all recorded Termine with their counts.
 * Removes the names of Termine past the retention period first.
 */
export async function GetAnwesenheitEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const now = new Date();
  await anonymizeExpired(now);
  // The SharePoint lists only add convenience; recording works without them
  const [gruppenstunden, leitende, meetings] = await Promise.all([
    getGruppenstunden().catch(() => []),
    getLeitende().catch(() => []),
    getMeetingSummaries(),
  ]);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      today: berlinToday(now),
      editableFrom: retentionStart(now),
      stufen: Object.entries(STUFE_SLUGS).map(([slug, stufe]) => {
        const gruppenstunde = gruppenstunden.find((g) => g.stufe === stufe);
        return {
          stufe,
          slug,
          weekday: gruppenstunde?.weekday ?? '',
          time: gruppenstunde?.time ?? '',
        };
      }),
      ownStufen: ownStufen(principal.userDetails, getClaim(principal, ['name']), leitende),
      meetings,
    },
  };
}

interface ChildView {
  id: string;
  firstName: string;
  lastName: string;
  present: boolean;
  /** Recorded as present, but now in another Stufe or no longer in CampFlow. */
  otherStufe: boolean;
  /** Whether CampFlow still knows the child. */
  known: boolean;
}

function byName(a: ChildView, b: ChildView): number {
  return (
    Number(a.otherStufe) - Number(b.otherStufe) ||
    a.firstName.localeCompare(b.firstName, 'de') ||
    a.lastName.localeCompare(b.lastName, 'de')
  );
}

export interface TerminView {
  stufe: string;
  date: string;
  editable: boolean;
  etag: string | null;
  notes: string;
  children: ChildView[];
  anonymized: number;
  guests: Guest[];
  anonymizedGuests: number;
}

export function buildTerminView(
  termin: Termin,
  record: Awaited<ReturnType<typeof getMeetingRecord>>,
  children: Child[],
  editable: boolean
): TerminView {
  const present = new Set(record.presentIds);
  const byId = new Map(children.map((child) => [child.id, child]));
  const views: ChildView[] = children
    .filter((child) => child.stufen.includes(termin.stufe))
    .map((child) => ({
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      present: present.has(child.id),
      otherStufe: false,
      known: true,
    }));
  for (const id of record.presentIds) {
    if (views.some((view) => view.id === id)) continue;
    const child = byId.get(id);
    views.push({
      id,
      firstName: child?.firstName ?? '',
      lastName: child?.lastName ?? '',
      present: true,
      otherStufe: true,
      known: child !== undefined,
    });
  }
  return {
    ...termin,
    editable,
    etag: record.etag,
    notes: record.notes,
    children: views.sort(byName),
    anonymized: record.anonymized,
    guests: record.guests,
    anonymizedGuests: record.anonymizedGuests,
  };
}

/** GET: the children of the Stufe from CampFlow and who was there on that date. */
export async function GetAnwesenheitTerminEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const now = new Date();
  const termin = readTermin(request, now);
  if (!termin) return NOT_FOUND;
  await anonymizeExpired(now);
  try {
    const [record, children] = await Promise.all([getMeetingRecord(termin), getChildren(now)]);
    const editable = termin.date >= retentionStart(now);
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: buildTerminView(termin, record, children, editable),
    };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

/** PUT: what the group did, saved against the loaded version. Returns the new version. */
export const AnwesenheitNotesEndpoint = pflegeHandler(
  AREA,
  async (request, _context, principal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const now = new Date();
    const termin = readTermin(request, now);
    if (!termin) return NOT_FOUND;
    requireEditable(termin, now);
    const input = validateMeetingNotes(await readJsonBody(request));
    return ok({ etag: await saveNotes(termin, input.notes, input.etag, principal.userDetails) });
  }
);

/** PUT: whether a current CampFlow member was there; repeating a request changes nothing. */
export const AnwesenheitChildEndpoint = pflegeHandler(
  AREA,
  async (request, _context, principal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const now = new Date();
    const termin = readTermin(request, now);
    const personId = request.params.id ?? '';
    if (!termin || !PERSON_ID_PATTERN.test(personId)) return NOT_FOUND;
    requireEditable(termin, now);
    const present = validatePresence(await readJsonBody(request));
    if (present) {
      try {
        const children = await getChildren(now);
        if (!children.some((child) => child.id === personId)) return NOT_FOUND;
      } catch (error: unknown) {
        return campflowErrorResponse(error);
      }
    }
    await setPresent(termin, personId, present, principal.userDetails);
    return NO_CONTENT;
  }
);

/** POST: adds a guest who is not in CampFlow. */
export const AnwesenheitGuestsEndpoint = pflegeHandler(
  AREA,
  async (request, _context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const now = new Date();
    const termin = readTermin(request, now);
    if (!termin) return NOT_FOUND;
    requireEditable(termin, now);
    const name = validateGuestName(await readJsonBody(request));
    return ok(await addGuest(termin, name, principal.userDetails), 201);
  }
);

/** DELETE: removes a guest; a guest that is already gone is fine. */
export const AnwesenheitGuestEndpoint = pflegeHandler(AREA, async (request) => {
  if (request.method !== 'DELETE') return METHOD_NOT_ALLOWED;
  const now = new Date();
  const termin = readTermin(request, now);
  const id = parseId(request.params.id ?? '');
  if (!termin || id === undefined) return NOT_FOUND;
  requireEditable(termin, now);
  await removeGuest(termin, id);
  return NO_CONTENT;
});

export const GetAnwesenheit = withErrorHandling(GetAnwesenheitEndpoint);
export const GetAnwesenheitTermin = withErrorHandling(GetAnwesenheitTerminEndpoint);
export const AnwesenheitNotes = withErrorHandling(AnwesenheitNotesEndpoint);
export const AnwesenheitChild = withErrorHandling(AnwesenheitChildEndpoint);
export const AnwesenheitGuests = withErrorHandling(AnwesenheitGuestsEndpoint);
export const AnwesenheitGuest = withErrorHandling(AnwesenheitGuestEndpoint);
