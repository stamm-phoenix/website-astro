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

/** Earliest first; also applied to the data baked at build time. */
export function sortAktionen(data: Aktion[]): Aktion[] {
  return data.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function fetchAktionen(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  aktionenStore.loading = true;
  aktionenStore.error = false;

  fetchPromise = (async () => {
    try {
      aktionenStore.data = sortAktionen(await fetchApi<Aktion[]>('/aktionen'));
    } catch {
      aktionenStore.error = true;
    } finally {
      fetchPromise = null;
      aktionenStore.loading = false;
    }
  })();

  return fetchPromise;
}
