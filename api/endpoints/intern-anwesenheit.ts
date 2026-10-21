import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { Child, MeetingRecord, Termin } from '../lib/anwesenheit';
import {
  PERSON_ID_PATTERN,
  addGuest,
  anonymizeExpired,
  deleteMeeting,
  getChildren,
  getMeetingRecord,
  getMeetingSummaries,
  withoutNames,
  isCurrentChild,
  isEditable,
  markAbsent,
  markChild,
  ownStufen,
  removeGuest,
  saveNotes,
  setCancelled,
  stufeFromSlug,
} from '../lib/anwesenheit';
import type {
  AnwesenheitChild as ChildView,
  AnwesenheitOverview,
  AnwesenheitStatus,
  AnwesenheitTermin,
} from '../lib/anwesenheit-model';
import { STUFE_SLUGS, isStufeSlug } from '../lib/anwesenheit-model';
import { campflowErrorResponse } from '../lib/campflow-api';
import { parseId } from '../lib/db';
import { getGruppenstunden } from '../lib/gruppenstunden-list';
import { getLeitende } from '../lib/leitende-list';
import { dateToLocalParts } from '../lib/nikolaus-config';
import {
  NOT_FOUND,
  NO_CONTENT,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import {
  ValidationError,
  isValidDate,
  validateCancelled,
  validateChildStatus,
  validateGuestName,
  validateMeetingNotes,
  validateMeetingDeletion,
} from '../lib/pflege-validation';
import { withErrorHandling } from '../lib/response-utils';
import { getClaim, isStaffError, requireStaff } from '../lib/staff-auth';

/** The Termin of a route, or `undefined` for an unknown Stufe or an invalid or future date. */
function readTermin(request: HttpRequest, now: Date): Termin | undefined {
  const stufe = stufeFromSlug(request.params.stufe);
  const date = request.params.datum ?? '';
  if (!stufe || !isValidDate(date) || date > dateToLocalParts(now).date) return undefined;
  return { stufe, date };
}

/**
 * Wraps a write endpoint of a Termin: answers 404 for an unknown Termin and refuses Termine
 * before the retention start, which keep only their counts.
 */
function terminHandler(
  work: (termin: Termin, request: HttpRequest, actor: string) => Promise<HttpResponseInit>
) {
  return pflegeHandler('anwesenheit', async (request, _context, principal) => {
    const now = new Date();
    const termin = readTermin(request, now);
    if (!termin) return NOT_FOUND;
    if (!isEditable(termin, now)) {
      throw new ValidationError({
        date: 'Dieser Termin liegt vor der Aufbewahrungsfrist und kann nicht mehr geändert werden.',
      });
    }
    return work(termin, request, principal.userDetails);
  });
}

/**
 * GET: the Gruppenstunden with their times, the Stufen the logged-in person leads (a
 * suggestion from the list „Leitende & Teams“) and all recorded Termine with their counts.
 * Removes the names of Termine past the retention period along the way.
 */
export async function GetAnwesenheitEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const now = new Date();
  // The counts hold no names, so the removal of expired ones runs along with the reads
  const [, gruppenstunden, leitende, meetings] = await Promise.all([
    anonymizeExpired(now),
    // The SharePoint lists only add convenience; recording works without them
    getGruppenstunden().catch(() => []),
    getLeitende().catch(() => []),
    getMeetingSummaries(),
  ]);
  const overview: AnwesenheitOverview = {
    today: dateToLocalParts(now).date,
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
    ownStufen: ownStufen(principal.userDetails, getClaim(principal, ['name']), leitende),
    meetings,
  };
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody: overview };
}

/** Children of the Stufe first, then visitors and unknown children, each by name. */
function byName(a: ChildView, b: ChildView): number {
  const nameOf = (child: ChildView): string =>
    child.kind === 'unbekannt' ? '' : `${child.firstName} ${child.lastName}`;
  return (
    Number(a.kind !== 'stufe') - Number(b.kind !== 'stufe') ||
    nameOf(a).localeCompare(nameOf(b), 'de')
  );
}

export function buildTerminView(
  termin: Termin,
  record: MeetingRecord,
  children: Child[],
  editable: boolean
): AnwesenheitTermin {
  const statusOf = (id: string): AnwesenheitStatus =>
    record.presentIds.includes(id)
      ? 'anwesend'
      : record.excusedIds.includes(id)
        ? 'entschuldigt'
        : 'abwesend';
  const byId = new Map(children.map((child) => [child.id, child]));
  const views: ChildView[] = children
    .filter((child) => child.stufen.includes(termin.stufe))
    .map((child) => ({
      kind: 'stufe',
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      status: statusOf(child.id),
    }));
  for (const id of [...record.presentIds, ...record.excusedIds]) {
    if (views.some((view) => view.id === id)) continue;
    const child = byId.get(id);
    const status = statusOf(id);
    views.push(
      child
        ? {
            kind: 'besuch',
            id,
            firstName: child.firstName,
            lastName: child.lastName,
            status,
          }
        : { kind: 'unbekannt', id, status }
    );
  }
  return {
    ...termin,
    editable,
    etag: record.etag,
    notes: record.notes,
    cancelled: record.cancelled,
    children: views.sort(byName),
    anonymized: record.anonymized,
    anonymizedExcused: record.anonymizedExcused,
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
  try {
    // Older Termine keep only their counts, so they need no names from CampFlow
    const editable = isEditable(termin, now);
    const [, record, children] = await Promise.all([
      anonymizeExpired(now),
      getMeetingRecord(termin),
      editable ? getChildren(now) : [],
    ]);
    // The removal runs along with the read, so an older Termin drops its names here as well
    return {
      status: 200,
      headers: NO_STORE_HEADERS,
      jsonBody: buildTerminView(
        termin,
        editable ? record : withoutNames(record),
        children,
        editable
      ),
    };
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
}

/**
 * PUT: what the group did, saved against the loaded version. Returns the new version.
 * DELETE: removes the Termin with its attendance and notes, if it still has the version sent
 * in `If-Match` and the attendance snapshot sent in the body.
 */
export const AnwesenheitNotesEndpoint = terminHandler(async (termin, request, actor) => {
  if (request.method === 'DELETE') {
    const etag = readIfMatch(request);
    const attendance = validateMeetingDeletion(await readJsonBody(request));
    await deleteMeeting(termin, etag, attendance);
    return NO_CONTENT;
  }
  const input = validateMeetingNotes(await readJsonBody(request));
  return ok({ etag: await saveNotes(termin, input.notes, input.etag, actor) });
});

/**
 * PUT: whether the Gruppenstunde was cancelled, saved against the loaded version. Returns the
 * new version of the Termin.
 */
export const AnwesenheitCancelledEndpoint = terminHandler(async (termin, request, actor) => {
  const input = validateCancelled(await readJsonBody(request));
  return ok({ etag: await setCancelled(termin, input, actor) });
});

/**
 * PUT: a current CampFlow member was there or was excused (`{ status }`). DELETE: neither.
 * Repeating a request changes nothing.
 */
export const AnwesenheitChildEndpoint = terminHandler(async (termin, request, actor) => {
  const personId = request.params.id ?? '';
  if (!PERSON_ID_PATTERN.test(personId)) return NOT_FOUND;
  if (request.method === 'DELETE') {
    await markAbsent(termin, personId);
    return NO_CONTENT;
  }
  const status = validateChildStatus(await readJsonBody(request));
  try {
    if (!(await isCurrentChild(personId))) return NOT_FOUND;
  } catch (error: unknown) {
    return campflowErrorResponse(error);
  }
  await markChild(termin, personId, status === 'entschuldigt', actor);
  return NO_CONTENT;
});

/** POST: adds a guest who is not in CampFlow. */
export const AnwesenheitGuestsEndpoint = terminHandler(async (termin, request, actor) => {
  const name = validateGuestName(await readJsonBody(request));
  return ok(await addGuest(termin, name, actor), 201);
});

/** DELETE: removes a guest; a guest that is already gone is fine. */
export const AnwesenheitGuestEndpoint = terminHandler(async (termin, request) => {
  const id = parseId(request.params.id ?? '');
  if (id === undefined) return NOT_FOUND;
  await removeGuest(termin, id);
  return NO_CONTENT;
});

export const GetAnwesenheit = withErrorHandling(GetAnwesenheitEndpoint);
export const GetAnwesenheitTermin = withErrorHandling(GetAnwesenheitTerminEndpoint);
export const AnwesenheitNotes = withErrorHandling(AnwesenheitNotesEndpoint);
export const AnwesenheitCancelled = withErrorHandling(AnwesenheitCancelledEndpoint);
export const AnwesenheitChild = withErrorHandling(AnwesenheitChildEndpoint);
export const AnwesenheitGuests = withErrorHandling(AnwesenheitGuestsEndpoint);
export const AnwesenheitGuest = withErrorHandling(AnwesenheitGuestEndpoint);
