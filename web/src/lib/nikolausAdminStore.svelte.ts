import { createResource } from './pflegeStore.svelte';
import type { StaffNikolausBooking, StaffNikolausOverview } from './types';

const overview = createResource<StaffNikolausOverview>('/intern/nikolaus/bookings');

/** All Nikolaus bookings with the slots; `loadedAt` tells when they were last loaded. */
export const nikolausAdminStore = overview.state;

/** Loads all Nikolaus bookings; `force` reloads even if data is already present. */
export function fetchNikolausOverview(options: { force?: boolean } = {}): Promise<void> {
  return overview.load(options);
}

/** Replaces one booking in the loaded data, e.g. after its tags were saved. */
export function replaceNikolausBooking(booking: StaffNikolausBooking): void {
  const bookings = nikolausAdminStore.data?.bookings;
  const index = bookings?.findIndex((b) => b.id === booking.id) ?? -1;
  if (bookings && index >= 0) bookings[index] = booking;
}
