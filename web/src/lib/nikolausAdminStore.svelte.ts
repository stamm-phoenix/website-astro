import { fetchApi } from './api';
import type { StaffNikolausOverview } from './types';

interface NikolausAdminStoreState {
  data: StaffNikolausOverview | null;
  loading: boolean;
  error: boolean;
  /** When the data was last loaded successfully (epoch milliseconds). */
  loadedAt: number | null;
}

export const nikolausAdminStore = $state<NikolausAdminStoreState>({
  data: null,
  loading: true,
  error: false,
  loadedAt: null,
});

let fetchPromise: Promise<void> | null = null;

/** Loads all Nikolaus bookings; `force` reloads even if data is already present. */
export function fetchNikolausOverview({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (nikolausAdminStore.data && !force) return Promise.resolve();
  if (fetchPromise) return fetchPromise;

  nikolausAdminStore.loading = true;
  nikolausAdminStore.error = false;

  fetchPromise = (async () => {
    try {
      nikolausAdminStore.data = await fetchApi<StaffNikolausOverview>('/intern/nikolaus/bookings');
      nikolausAdminStore.loadedAt = Date.now();
    } catch {
      nikolausAdminStore.error = true;
    } finally {
      fetchPromise = null;
      nikolausAdminStore.loading = false;
    }
  })();

  return fetchPromise;
}
