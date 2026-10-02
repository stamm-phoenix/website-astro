import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import type { DispoRow } from '../lib/nikolaus-dispo-list';
import { getAllBookings } from '../lib/nikolaus-bookings';
import { dateToLocalParts } from '../lib/nikolaus-config';
import { getDispoRows } from '../lib/nikolaus-dispo-list';
import { confirmedOfDay } from '../lib/nikolaus-day';
import { timeToMinutes } from '../lib/nikolaus-dispo';
import { getVisitedTime } from '../lib/nikolaus-visit-time';
import { computeVisitProgress } from '../lib/nikolaus-progress';
import {
  NO_STORE_HEADERS,
  isErrorResponse,
  loadAuthorizedBooking,
  withNikolausNoStore,
} from '../lib/nikolaus-api';

/**
 * On the visit day many families may keep this page open, each asking every few minutes.
 * The lists are therefore read at most every 30 seconds per instance.
 */
const CACHE_MS = 30_000;

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + CACHE_MS, value });
  // A failed read is not kept, the next request tries again
  value.catch(() => cache.delete(key));
  return value;
}

const loadBookings = (): Promise<NikolausBooking[]> => cached('bookings', getAllBookings);
const loadDispo = (date: string): Promise<DispoRow[]> =>
  cached(`dispo:${date}`, () => getDispoRows(date));

function respond(jsonBody: Record<string, unknown>): HttpResponseInit {
  return { status: 200, headers: NO_STORE_HEADERS, jsonBody };
}

/**
 * POST: how far the Nikolaus still is from the family, like a parcel tracking. Only the number
 * of visits before the family's and the expected arrival are given – never where the team is
 * or anything about other families. `phase`:
 * - `none`: the booking is not confirmed, nothing to show
 * - `before` / `over`: the visit day has not come yet / is over
 * - `planning`: visit day, but the family is not (or no longer) in the saved Dispo
 * - `today`: visit day with progress
 */
export async function GetNikolausProgressEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const result = await loadAuthorizedBooking(request, loadBookings);
  if (isErrorResponse(result)) return result;
  const { booking } = result;

  if (booking.status !== 'Bestaetigt') return respond({ phase: 'none' });

  const [date] = booking.slotKey.split('T');
  const now = dateToLocalParts(new Date());
  if (now.date < date) return respond({ phase: 'before' });
  if (now.date > date) return respond({ phase: 'over' });

  const [allRows, bookings] = await Promise.all([loadDispo(date), loadBookings()]);
  // Visits of bookings cancelled or moved to another day since the Dispo was saved are not
  // on the route any more and must not count as visits ahead
  const confirmed = new Set(confirmedOfDay(bookings, date).map((b) => b.id));
  const rows = allRows.filter((row) => confirmed.has(row.bookingId));
  const own = rows.find((row) => row.bookingId === booking.id);
  if (!own || own.slotKey !== booking.slotKey) return respond({ phase: 'planning' });

  const children = new Map(bookings.map((b) => [b.id, b.childrenCount]));
  const progress = computeVisitProgress(
    rows.map((row) => ({
      ...row,
      visitedAt: getVisitedTime(row.visitedAt),
      childrenCount: children.get(row.bookingId) ?? 0,
    })),
    booking.id,
    timeToMinutes(now.time)
  );
  if (!progress) return respond({ phase: 'planning' });

  return respond({
    phase: 'today',
    position: progress.position,
    stopsAhead: progress.stopsAhead,
    started: progress.started,
    plannedArrival: progress.plannedArrival,
    eta: progress.eta,
    delayMinutes: progress.delayMinutes,
    visited: progress.visited,
  });
}

export default withNikolausNoStore(GetNikolausProgressEndpoint);
