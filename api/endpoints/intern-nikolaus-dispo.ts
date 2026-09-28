import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getAllBookings, isBlocking } from '../lib/nikolaus-bookings';
import { NIKOLAUS_CONFIG, getNikolausTeams } from '../lib/nikolaus-config';
import { DISPO_MINUTES_PER_CHILD, DISPO_MIN_VISIT_MINUTES } from '../lib/nikolaus-dispo';
import { getDispoRows, getDispoVersion, saveDispo } from '../lib/nikolaus-dispo-list';
import { NO_STORE_HEADERS, toLocation, toStaffBooking } from '../lib/nikolaus-api';
import { getTravelMatrix } from '../lib/travel-times';
import { validateDispoSave } from '../lib/pflege-validation';
import {
  CONFLICT,
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ok,
  pflegeHandler,
  readJsonBody,
} from '../lib/pflege-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** Only the fields the Dispo page needs; the rest of a row stays on the server. */
function toClientRow(row: DispoRow) {
  return {
    bookingId: row.bookingId,
    team: row.team,
    order: row.order,
    slotKey: row.slotKey,
    plannedArrival: row.plannedArrival,
    fixed: row.fixed,
    visited: row.visited,
    visitedAt: row.visitedAt,
  };
}

function readDate(request: HttpRequest): string | null {
  const date = request.query.get('date') ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && getNikolausTeams(date).length > 0 ? date : null;
}

/** Confirmed bookings of a day, in chronological order. */
function confirmedOfDay(bookings: NikolausBooking[], date: string): NikolausBooking[] {
  return bookings
    .filter((b) => b.status === 'Bestaetigt' && b.slotKey.startsWith(`${date}T`))
    .sort((a, b) => a.slotKey.localeCompare(b.slotKey) || Number(a.id) - Number(b.id));
}

/**
 * GET: everything the Dispo page needs for one day – the confirmed bookings, the driving
 * times between them and the saved Dispo. The distribution itself is calculated in the
 * browser (`lib/nikolaus-dispo.ts`), so changes by hand are rated instantly.
 */
export async function GetInternNikolausDispoEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const now = new Date();
  const [bookings, rows] = await Promise.all([getAllBookings(), getDispoRows(date)]);
  const stops = confirmedOfDay(bookings, date);
  const pending = bookings.filter(
    (b) => b.status === 'Ausstehend' && b.slotKey.startsWith(`${date}T`) && isBlocking(b, now)
  ).length;

  const { base } = NIKOLAUS_CONFIG.area;
  const travel = await getTravelMatrix([base, ...stops.map((b) => toLocation(b))]);

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      date,
      teams: getNikolausTeams(date),
      minutesPerChild: DISPO_MINUTES_PER_CHILD,
      minVisitMinutes: DISPO_MIN_VISIT_MINUTES,
      stops: stops.map((b) => toStaffBooking(b, now)),
      travel: travel.minutes,
      travelSource: travel.source,
      rows: rows.map(toClientRow),
      version: getDispoVersion(rows),
      pendingCount: pending,
    },
  };
}

/** PUT: saves the Dispo of a day. Answers with the saved rows and their new version. */
export const NikolausDispoSave = pflegeHandler('nikolaus-dispo', async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const [bookings, existing] = await Promise.all([getAllBookings(), getDispoRows(date)]);
  const bookingSlots = new Map(confirmedOfDay(bookings, date).map((b) => [b.id, b.slotKey]));
  const teams = getNikolausTeams(date).map((team) => team.name);
  const input = validateDispoSave(await readJsonBody(request), teams, bookingSlots);

  if (input.version !== getDispoVersion(existing)) return CONFLICT;

  await saveDispo(date, input.entries, existing);
  const rows = await getDispoRows(date);
  return ok({ rows: rows.map(toClientRow), version: getDispoVersion(rows) });
});

export default withErrorHandling(GetInternNikolausDispoEndpoint);
