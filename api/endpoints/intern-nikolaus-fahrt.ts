import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getAllBookings } from '../lib/nikolaus-bookings';
import { NIKOLAUS_CONFIG, dateToLocalParts, getNikolausTeams } from '../lib/nikolaus-config';
import { getDispoRows, setDispoVisited } from '../lib/nikolaus-dispo-list';
import { confirmedOfDay, getTeamMembers, readDate } from '../lib/nikolaus-day';
import { NO_STORE_HEADERS, toLocation } from '../lib/nikolaus-api';
import { validateDispoVisit } from '../lib/pflege-validation';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

/** One visit of a team's route with what the team needs at the door. */
function toFahrtStop(row: DispoRow, booking: NikolausBooking) {
  return {
    bookingId: row.bookingId,
    order: row.order,
    plannedArrival: row.plannedArrival,
    slotKey: booking.slotKey,
    /** The booking was moved to another slot after the Dispo was saved. */
    moved: row.slotKey !== booking.slotKey,
    visited: row.visited,
    visitedAt: row.visitedAt,
    familyName: booking.familyName,
    phone: booking.phone,
    street: booking.street,
    postalCode: booking.postalCode,
    city: booking.city,
    addressNotes: booking.addressNotes,
    childrenCount: booking.childrenCount,
    withKrampus: booking.withKrampus,
    hidingPlace: booking.hidingPlace,
    notes: booking.notes,
    location: toLocation(booking),
  };
}

/**
 * GET: the routes of all teams of a day as saved in the Dispo, for the teams on their way.
 * Only visits of bookings that are still confirmed on this day are listed; the others are
 * counted, so the team knows the Dispo is out of date.
 */
export async function GetInternNikolausFahrtEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const [bookings, rows, members] = await Promise.all([
    getAllBookings(),
    getDispoRows(date),
    getTeamMembers(date),
  ]);
  const teams = getNikolausTeams(date);
  const confirmed = new Map(confirmedOfDay(bookings, date).map((b) => [b.id, b]));

  const routes: Record<string, ReturnType<typeof toFahrtStop>[]> = Object.fromEntries(
    teams.map((team) => [team.name, []])
  );
  const planned = new Set<string>();
  let dropped = 0;
  for (const row of rows) {
    const booking = confirmed.get(row.bookingId);
    const route = routes[row.team];
    if (!booking || !route || planned.has(row.bookingId)) {
      dropped++;
      continue;
    }
    planned.add(row.bookingId);
    route.push(toFahrtStop(row, booking));
  }
  for (const route of Object.values(routes)) route.sort((a, b) => a.order - b.order);

  const { base } = NIKOLAUS_CONFIG.area;
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      date,
      teams,
      base,
      dispoSaved: rows.length > 0,
      routes,
      members: Object.fromEntries(
        Object.entries(members).map(([team, list]) => [
          team,
          list.map((member) => ({ name: member.name, role: member.role })),
        ])
      ),
      unplannedCount: [...confirmed.keys()].filter((id) => !planned.has(id)).length,
      droppedCount: dropped,
    },
  };
}

/**
 * POST: checks off a visit of a day (or undoes it). The time is taken from the server, so it
 * does not depend on the clock of the phone.
 */
export const NikolausFahrtVisit = pflegeHandler('nikolaus-fahrt', async (request) => {
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const input = validateDispoVisit(await readJsonBody(request));
  const [bookings, rows] = await Promise.all([getAllBookings(), getDispoRows(date)]);
  const row = rows.find((r) => r.bookingId === input.bookingId);
  // Like the GET: only visits of bookings still confirmed on this day
  const confirmed = confirmedOfDay(bookings, date).some((b) => b.id === input.bookingId);
  if (!row || !confirmed) return NOT_FOUND;

  const visitedAt = input.visited ? dateToLocalParts(new Date()).time : '';
  await setDispoVisited(row, input.visited, visitedAt);
  return ok({ bookingId: row.bookingId, visited: input.visited, visitedAt });
});

export default withErrorHandling(GetInternNikolausFahrtEndpoint);
