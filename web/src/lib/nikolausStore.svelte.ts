import type { NikolausSlot } from './types';
import { fetchApi } from './api';

interface NikolausStoreState {
  data: NikolausSlot[] | null;
  loading: boolean;
  error: boolean;
}

export const nikolausStore = $state<NikolausStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/**
 * Loads the slot availability. Pass `force` to reload after a booking attempt,
 * so the displayed capacity reflects bookings made in the meantime.
 */
export function fetchNikolausSlots(force = false): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (nikolausStore.data !== null && !force) return Promise.resolve();

  nikolausStore.loading = nikolausStore.data === null;
  nikolausStore.error = false;

  fetchPromise = (async () => {
    try {
      nikolausStore.data = await fetchApi<NikolausSlot[]>('/nikolaus/slots');
    } catch {
      nikolausStore.error = true;
    } finally {
      fetchPromise = null;
      nikolausStore.loading = false;
    }
  })();

  return fetchPromise;
}
