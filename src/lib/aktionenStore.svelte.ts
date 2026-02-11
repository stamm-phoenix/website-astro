import type { Aktion } from './types';
import { fetchApi } from './api';

interface AktionenStoreState {
  data: Aktion[] | null;
  loading: boolean;
  error: boolean;
}

export const aktionenStore = $state<AktionenStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchAktionen(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (aktionenStore.data !== null) return Promise.resolve();

  aktionenStore.loading = true;
  aktionenStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = await fetchApi<Aktion[]>('/aktionen');
      aktionenStore.data = data.sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      aktionenStore.loading = false;
    } catch {
      fetchPromise = null;
      aktionenStore.error = true;
      aktionenStore.loading = false;
    }
  })();

  return fetchPromise;
}
