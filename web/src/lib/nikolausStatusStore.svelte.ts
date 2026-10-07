import { fetchApi } from './api';
import type { StaffNikolausStatus } from './types';

interface NikolausStatusState {
  data: StaffNikolausStatus | null;
  loading: boolean;
  error: boolean;
}

/** Whether the Nikolaus modules are on and whether the data is due for deletion. */
export const nikolausStatusStore = $state<NikolausStatusState>({
  data: null,
  loading: false,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/** Loads the status once per page; reuses a running request. */
export function fetchNikolausStatus(): Promise<void> {
  if (nikolausStatusStore.data !== null) return Promise.resolve();
  if (fetchPromise) return fetchPromise;
  nikolausStatusStore.loading = true;
  nikolausStatusStore.error = false;
  fetchPromise = (async () => {
    try {
      nikolausStatusStore.data = await fetchApi<StaffNikolausStatus>('/intern/nikolaus/status');
    } catch {
      nikolausStatusStore.error = true;
    } finally {
      fetchPromise = null;
      nikolausStatusStore.loading = false;
    }
  })();
  return fetchPromise;
}
