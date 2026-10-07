import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getAllBookings, isBlocking } from '../lib/nikolaus-bookings';
import { NIKOLAUS_CONFIG, getNikolausTeams } from '../lib/nikolaus-config';
import { DISPO_MINUTES_PER_CHILD, DISPO_MIN_VISIT_MINUTES } from '../lib/nikolaus-dispo';
import { getVisitedTime } from '../lib/nikolaus-visit-time';
import { getDispoRows, getDispoVersion, saveDispo } from '../lib/nikolaus-dispo-list';
import { NO_STORE_HEADERS, toLocation, toStaffBooking } from '../lib/nikolaus-api';
import { getRoutePath, getTravelMatrix } from '../lib/travel-times';
import { confirmedOfDay, getTeamMembers, readDate } from '../lib/nikolaus-day';
import { validateDispoSave } from '../lib/pflege-validation';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/** Upper limit of stops per request, far above a real evening. */
const MAX_ROUTE_STOPS = 200;

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
    visitedAt: getVisitedTime(row.visitedAt),
  };
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
  const [bookings, rows, members] = await Promise.all([
    getAllBookings(),
    getDispoRows(date),
    getTeamMembers(date),
  ]);
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
      members,
    },
  };
}

/** PUT: saves the Dispo of a day. Answers with the saved rows and their new version. */
export const NikolausDispoSave = pflegeHandler('nikolaus-dispo', async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const bookings = await getAllBookings();
  const bookingSlots = new Map(confirmedOfDay(bookings, date).map((b) => [b.id, b.slotKey]));
  const teams = getNikolausTeams(date).map((team) => team.name);
  const input = validateDispoSave(await readJsonBody(request), teams, bookingSlots);

  await saveDispo(date, input.entries, input.version);
  const rows = await getDispoRows(date);
  return ok({ rows: rows.map(toClientRow), version: getDispoVersion(rows) });
});

/**
 * POST: the course of each team's route along the roads, for the map only. The body names the
 * booking IDs per team in route order; the coordinates are taken from the bookings, so the
 * endpoint cannot be used to route arbitrary places. Teams without a result get `null`.
 */
export async function GetInternNikolausDispoRoutesEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

  const date = readDate(request);
  if (!date) return NOT_FOUND;

  const body = await readJsonBody(request);
  const routes = body?.routes;
  const teams = getNikolausTeams(date).map((team) => team.name);
  const valid =
    routes !== null &&
    typeof routes === 'object' &&
    !Array.isArray(routes) &&
    Object.entries(routes).every(
      ([team, ids]) =>
        teams.includes(team) &&
        Array.isArray(ids) &&
        ids.length <= MAX_ROUTE_STOPS &&
        ids.every((id) => typeof id === 'string')
    );
  if (!valid) {
    return errorResponse(400, 'INVALID', 'Die Routen sind ungültig.');
  }

  const locations = new Map(
    confirmedOfDay(await getAllBookings(), date).map((b) => [b.id, toLocation(b)])
  );
  const { base } = NIKOLAUS_CONFIG.area;
  const entries = await Promise.all(
    Object.entries(routes as Record<string, string[]>).map(async ([team, ids]) => {
      const stops = ids.flatMap((id) => {
        const location = locations.get(id);
        return location ? [{ lat: location.lat, lon: location.lon }] : [];
      });
      const path = stops.length > 0 ? await getRoutePath([base, ...stops, base]) : null;
      return [team, path] as const;
    })
  );

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: { paths: Object.fromEntries(entries) },
  };
}

export const NikolausDispoRoutes = withErrorHandling(GetInternNikolausDispoRoutesEndpoint);

export default withErrorHandling(GetInternNikolausDispoEndpoint);
