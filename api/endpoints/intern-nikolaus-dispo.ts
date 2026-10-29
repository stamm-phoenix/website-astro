import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { z } from 'zod';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import type { NikolausSettings } from '../lib/nikolaus-config';
import { getAllBookings, isBlocking } from '../lib/nikolaus-bookings';
import { getNikolausTeams, localDateTimeToDate } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import {
  isNikolausStaffError,
  readAsNikolausStaff,
  requireNikolausStaff,
} from '../lib/nikolaus-staff';
import {
  DISPO_MAX_VISIT_MINUTES,
  DISPO_MINUTES_PER_CHILD,
  DISPO_MIN_VISIT_MINUTES,
} from '../lib/nikolaus-dispo';
import { getVisitedTime } from '../lib/nikolaus-visit-time';
import { getDispoRows, getDispoVersion, saveDispo } from '../lib/nikolaus-dispo-list';
import { NO_STORE_HEADERS, toLocation, toStaffBooking } from '../lib/nikolaus-api';
import { getRoutePath, getTravelMatrix } from '../lib/travel-times';
import { confirmedOfDay, getTeamMembers, readDate, readDateParam } from '../lib/nikolaus-day';
import { validateDispoSave } from '../lib/validation/nikolaus-dispo';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/** Upper limit of stops per request, far above a real evening. */
const MAX_ROUTE_STOPS = 200;

/** The booking IDs per team in route order; only the teams of the day are accepted. */
function routesSchema(teams: string[]) {
  return z
    .record(z.string(), z.array(z.string()).max(MAX_ROUTE_STOPS))
    .refine((routes) => Object.keys(routes).every((team) => teams.includes(team)));
}

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
    // Exact time, so the Dispo knows the order of check-offs within the same minute
    checkedOffAt: row.visitedAt,
  };
}

/** The usual traffic when the teams set off; once the evening has begun, without traffic. */
function departureOf(config: NikolausSettings, date: string): string | undefined {
  const start = config.days.find((day) => day.date === date)?.start;
  return start
    ? localDateTimeToDate(date, start)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
    : undefined;
}

/**
 * GET: everything the Dispo page needs for one day – the confirmed bookings, the driving
 * times between them and the saved Dispo. The distribution itself is calculated in the
 * browser (`lib/nikolaus-dispo.ts`), so changes by hand are rated instantly.
 */
export async function GetInternNikolausDispoEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const requested = readDateParam(request);
  const access = await readAsNikolausStaff(request, async (active) => {
    if (!requested) return null;
    const bookings = getAllBookings();
    // The driving times start with the bookings, while the Dispo and the Einteilung still load
    const travel = Promise.all([active, bookings]).then(([config, list]) => {
      const day = readDate(request, config) ? confirmedOfDay(list, requested) : [];
      return getTravelMatrix([config.area.base, ...day.map((b) => toLocation(b))], {
        departAt: departureOf(config, requested),
      });
    });
    return Promise.all([bookings, getDispoRows(requested), getTeamMembers(requested), travel]);
  });
  if (isNikolausStaffError(access)) return access;
  const { config, data } = access;

  const date = readDate(request, config);
  if (!date || !data) return NOT_FOUND;

  const now = new Date();
  const [bookings, rows, members, travel] = data;
  const stops = confirmedOfDay(bookings, date);
  const pending = bookings.filter(
    (b) => b.status === 'Ausstehend' && b.slotKey.startsWith(`${date}T`) && isBlocking(b, now)
  ).length;

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      date,
      teams: getNikolausTeams(date, config),
      minutesPerChild: DISPO_MINUTES_PER_CHILD,
      minVisitMinutes: DISPO_MIN_VISIT_MINUTES,
      maxVisitMinutes: DISPO_MAX_VISIT_MINUTES,
      stops: stops.map((b) => toStaffBooking(b, now)),
      travel: travel.minutes,
      travelSource: travel.source,
      // A saved row may belong to a booking that left the day; the page still names the family
      rows: rows.map((row) => ({
        ...toClientRow(row),
        familyName: bookings.find((b) => b.id === row.bookingId)?.familyName ?? null,
      })),
      version: getDispoVersion(rows),
      pendingCount: pending,
      members,
    },
  };
}

/** PUT: saves the Dispo of a day. Answers with the saved rows and their new version. */
export const NikolausDispoSave = pflegeHandler('nikolaus-dispo', async (request) => {
  if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
  const config = await getNikolausSettings();
  const date = readDate(request, config);
  if (!date) return NOT_FOUND;

  const bookings = await getAllBookings();
  const bookingSlots = new Map(confirmedOfDay(bookings, date).map((b) => [b.id, b.slotKey]));
  const teams = getNikolausTeams(date, config).map((team) => team.name);
  const input = validateDispoSave(await readJsonBody(request), teams, bookingSlots);

  await saveDispo(date, input.entries, input.version, input.done);
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
  const access = await requireNikolausStaff(request);
  if (isNikolausStaffError(access)) return access;
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
  const { config } = access;

  const date = readDate(request, config);
  if (!date) return NOT_FOUND;

  const body = await readJsonBody(request);
  const teams = getNikolausTeams(date, config).map((team) => team.name);
  const parsed = routesSchema(teams).safeParse(body?.routes);
  if (!parsed.success) {
    return errorResponse(400, 'INVALID', 'Die Routen sind ungültig.');
  }
  const routes = parsed.data;

  const locations = new Map(
    confirmedOfDay(await getAllBookings(), date).map((b) => [b.id, toLocation(b)])
  );
  const { base } = config.area;
  const entries = await Promise.all(
    Object.entries(routes).map(async ([team, ids]) => {
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
