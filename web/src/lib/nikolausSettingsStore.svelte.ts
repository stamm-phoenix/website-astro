import { fetchApi } from './api';
import type { NikolausConfig } from './nikolausConfig';

interface NikolausSettingsState {
  data: NikolausConfig | null;
  loading: boolean;
  error: boolean;
}

/** The public settings of the Nikolausdienst (days, times, service area) from the Steuerung. */
export const nikolausSettingsStore = $state<NikolausSettingsState>({
  data: null,
  loading: false,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

/** Loads the settings once per page; reuses a running request. */
export function fetchNikolausSettings(): Promise<void> {
  if (nikolausSettingsStore.data !== null) return Promise.resolve();
  if (fetchPromise) return fetchPromise;
  nikolausSettingsStore.loading = true;
  nikolausSettingsStore.error = false;
  fetchPromise = (async () => {
    try {
      nikolausSettingsStore.data = await fetchApi<NikolausConfig>('/nikolaus/settings');
    } catch {
      nikolausSettingsStore.error = true;
    } finally {
      fetchPromise = null;
      nikolausSettingsStore.loading = false;
    }
  })();
  return fetchPromise;
}
