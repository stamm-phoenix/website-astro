import { fetchApi } from './api';
import type { StaffNikolausDispoData } from './types';

interface NikolausDispoStoreState {
  data: StaffNikolausDispoData | null;
  loading: boolean;
  error: boolean;
}

export const nikolausDispoStore = $state<NikolausDispoStoreState>({
  data: null,
  loading: false,
  error: false,
});

let requestId = 0;

/** Loads bookings, driving times and the saved Dispo of a day; older answers are ignored. */
export async function fetchNikolausDispo(date: string): Promise<void> {
  const current = ++requestId;
  nikolausDispoStore.loading = true;
  nikolausDispoStore.error = false;
  try {
    const data = await fetchApi<StaffNikolausDispoData>(
      `/intern/nikolaus/dispo?date=${encodeURIComponent(date)}`
    );
    if (current === requestId) nikolausDispoStore.data = data;
  } catch {
    if (current === requestId) nikolausDispoStore.error = true;
  } finally {
    if (current === requestId) nikolausDispoStore.loading = false;
  }
}
