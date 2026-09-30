import type { Vorstand } from './types';
import { fetchApi } from './api';

interface VorstandStoreState {
  data: Vorstand[] | null;
  loading: boolean;
  error: boolean;
}

export const vorstandStore = $state<VorstandStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchVorstand(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  vorstandStore.loading = true;
  vorstandStore.error = false;

  fetchPromise = (async () => {
    try {
      vorstandStore.data = await fetchApi<Vorstand[]>('/vorstand');
    } catch {
      vorstandStore.error = true;
    } finally {
      fetchPromise = null;
      vorstandStore.loading = false;
    }
  })();

  return fetchPromise;
}
