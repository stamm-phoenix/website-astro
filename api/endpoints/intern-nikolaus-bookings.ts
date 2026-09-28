import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { getAllBookings, isBlocking } from '../lib/nikolaus-bookings';
import { getNikolausSlots } from '../lib/nikolaus-config';
import { NO_STORE_HEADERS, toStaffBooking } from '../lib/nikolaus-api';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import { withErrorHandling } from '../lib/response-utils';

interface StaffSlotOverview {
  key: string;
  date: string;
  time: string;
  endTime: string;
  capacity: number;
  /** Bookings currently occupying a place (confirmed or pending within the hold time). */
  taken: number;
}

/** Read-only overview of all Nikolaus bookings for the Leitendenbereich. */
export async function GetInternNikolausBookingsEndpoint(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;

  const now = new Date();
  const bookings = await getAllBookings();

  const taken = new Map<string, number>();
  for (const booking of bookings) {
    if (isBlocking(booking, now)) {
      taken.set(booking.slotKey, (taken.get(booking.slotKey) ?? 0) + 1);
    }
  }

  const slots: StaffSlotOverview[] = getNikolausSlots().map((slot) => ({
    key: slot.key,
    date: slot.date,
    time: slot.time,
    endTime: slot.endTime,
    capacity: slot.capacity,
    taken: taken.get(slot.key) ?? 0,
  }));

  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      slots,
      bookings: bookings.map((booking) => toStaffBooking(booking, now)),
    },
  };
}

export default withErrorHandling(GetInternNikolausBookingsEndpoint);
