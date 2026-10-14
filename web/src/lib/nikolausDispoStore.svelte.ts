import { createResource } from './pflegeStore.svelte';
import type { StaffNikolausDispoData } from './types';

const dispo = createResource<StaffNikolausDispoData, string>(
  (date) => `/intern/nikolaus/dispo?date=${encodeURIComponent(date)}`
);

export const nikolausDispoStore = dispo.state;

/** Loads bookings, driving times and the saved Dispo of a day; older answers are ignored. */
export function fetchNikolausDispo(date: string): Promise<void> {
  return dispo.load({ force: true, param: date });
}
